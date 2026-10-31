"""On-disk library of named graphs; one of them is loaded into the session."""

from __future__ import annotations

import json
import os
import re
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional

from .session import GraphSession

DEFAULT_GRAPH_NAME = "默认图谱"
STARTUP_GRAPH_NAME = "启动图谱"
MAX_NAME_LENGTH = 80
SAVE_DELAY_SECONDS = 1.5
_GRAPH_ID = re.compile(r"^[0-9a-f]{32}$")


class GraphLibraryError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def resolve_graph_root() -> Path:
    configured = os.environ.get("SEMANTICA_DATA_DIR", "").strip()
    if configured:
        return Path(configured) / "graphs"
    return Path.home() / ".semantica" / "explorer" / "graphs"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean_name(name: Any) -> str:
    cleaned = " ".join(str(name or "").split())
    if not cleaned:
        raise GraphLibraryError(422, "Graph name is required.")
    if len(cleaned) > MAX_NAME_LENGTH:
        raise GraphLibraryError(422, f"Graph name must be at most {MAX_NAME_LENGTH} characters.")
    return cleaned


class GraphLibrary:
    """Keeps every graph as ``<id>.json`` and tracks which one is active.

    Only the active graph lives in memory. Switching saves it first, then loads
    the target into the same session so existing references stay valid.
    """

    def __init__(
        self,
        root: Path,
        session: GraphSession,
        on_reload: Optional[Callable[[dict[str, Any]], None]] = None,
    ) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self.session = session
        self.on_reload = on_reload
        self._catalog_path = self.root / "catalog.json"
        self._lock = threading.RLock()
        self._timer: Optional[threading.Timer] = None
        self._active_id: Optional[str] = None
        self._graphs: list[dict[str, Any]] = []
        self._read_catalog()

    def attach(self, adopt_session: bool) -> None:
        """Pick the active graph at startup.

        ``adopt_session`` is true when the caller supplied the session (CLI
        ``--graph``, embedding code, tests): its contents win and are stored
        under the session's source name. Otherwise the last active graph on
        disk is loaded.
        """
        with self._lock:
            if adopt_session:
                name = self.session.source_name or STARTUP_GRAPH_NAME
                entry = self._find_by_name(name) or self._new_entry(name)
                self._active_id = entry["id"]
                self._save_active_locked()
                return
            entry = self._entry(self._active_id) if self._active_id else None
            if entry is None and self._graphs:
                entry = self._graphs[0]
            if entry is None:
                entry = self._new_entry(DEFAULT_GRAPH_NAME)
                self._active_id = entry["id"]
                self._save_active_locked()
                return
            self._active_id = entry["id"]
            self.session.replace_graph_contents(self._read_graph(entry["id"]))
            self._write_catalog()

    def list_graphs(self) -> dict[str, Any]:
        with self._lock:
            graphs = [self._public(entry) for entry in self._graphs]
            return {"active_id": self._active_id, "graphs": graphs}

    def active(self) -> Optional[dict[str, Any]]:
        with self._lock:
            entry = self._entry(self._active_id) if self._active_id else None
            return self._public(entry) if entry else None

    def create(self, name: Any) -> dict[str, Any]:
        cleaned = _clean_name(name)
        with self._lock:
            if self._find_by_name(cleaned):
                raise GraphLibraryError(409, f"A graph named '{cleaned}' already exists.")
            entry = self._new_entry(cleaned)
            self._graph_path(entry["id"]).write_text(
                json.dumps({"nodes": [], "edges": []}, ensure_ascii=False),
                encoding="utf-8",
            )
            self._write_catalog()
            return self._public(entry)

    def rename(self, graph_id: str, name: Any) -> dict[str, Any]:
        cleaned = _clean_name(name)
        with self._lock:
            entry = self._require(graph_id)
            other = self._find_by_name(cleaned)
            if other is not None and other["id"] != graph_id:
                raise GraphLibraryError(409, f"A graph named '{cleaned}' already exists.")
            entry["name"] = cleaned
            entry["updated_at"] = _now()
            self._write_catalog()
            return self._public(entry)

    def delete(self, graph_id: str) -> None:
        with self._lock:
            entry = self._require(graph_id)
            if graph_id == self._active_id:
                raise GraphLibraryError(409, "Switch to another graph before deleting this one.")
            self._graphs.remove(entry)
            self._graph_path(graph_id).unlink(missing_ok=True)
            self._write_catalog()

    def activate(self, graph_id: str) -> dict[str, Any]:
        with self._lock:
            entry = self._require(graph_id)
            if graph_id != self._active_id:
                self._cancel_timer()
                self._save_active_locked()
                data = self._read_graph(graph_id)
                self.session.replace_graph_contents(data)
                self._active_id = graph_id
                self._write_catalog()
            public = self._public(entry)
        if self.on_reload is not None:
            self.on_reload(public)
        return public

    def mark_dirty(self) -> None:
        with self._lock:
            if self._timer is not None:
                return
            self._timer = threading.Timer(SAVE_DELAY_SECONDS, self.save_active)
            self._timer.daemon = True
            self._timer.start()

    def save_active(self) -> None:
        with self._lock:
            self._cancel_timer()
            self._save_active_locked()

    def close(self) -> None:
        self.save_active()

    def _save_active_locked(self) -> None:
        entry = self._entry(self._active_id) if self._active_id else None
        if entry is None:
            return
        data = self.session.graph.to_dict()
        target = self._graph_path(entry["id"])
        staging = target.with_suffix(".json.tmp")
        staging.write_text(json.dumps(data, ensure_ascii=False, default=str), encoding="utf-8")
        os.replace(staging, target)
        stats = data.get("statistics") or {}
        entry["node_count"] = int(stats.get("node_count", len(data.get("nodes", []))))
        entry["edge_count"] = int(stats.get("edge_count", len(data.get("edges", []))))
        entry["updated_at"] = _now()
        self._write_catalog()

    def _cancel_timer(self) -> None:
        if self._timer is not None:
            self._timer.cancel()
            self._timer = None

    def _public(self, entry: dict[str, Any]) -> dict[str, Any]:
        public = dict(entry)
        if entry["id"] == self._active_id:
            public["node_count"] = len(self.session.graph.nodes)
            public["edge_count"] = len(self.session.graph.edges)
        public["active"] = entry["id"] == self._active_id
        return public

    def _new_entry(self, name: str) -> dict[str, Any]:
        now = _now()
        entry = {
            "id": uuid.uuid4().hex,
            "name": name,
            "node_count": 0,
            "edge_count": 0,
            "created_at": now,
            "updated_at": now,
        }
        self._graphs.append(entry)
        return entry

    def _entry(self, graph_id: Optional[str]) -> Optional[dict[str, Any]]:
        return next((entry for entry in self._graphs if entry["id"] == graph_id), None)

    def _require(self, graph_id: str) -> dict[str, Any]:
        entry = self._entry(graph_id) if _GRAPH_ID.fullmatch(graph_id or "") else None
        if entry is None:
            raise GraphLibraryError(404, "Graph not found.")
        return entry

    def _find_by_name(self, name: str) -> Optional[dict[str, Any]]:
        return next((entry for entry in self._graphs if entry["name"] == name), None)

    def _graph_path(self, graph_id: str) -> Path:
        return self.root / f"{graph_id}.json"

    def _read_graph(self, graph_id: str) -> dict[str, Any]:
        path = self._graph_path(graph_id)
        if not path.is_file():
            return {"nodes": [], "edges": []}
        return json.loads(path.read_text(encoding="utf-8"))

    def _read_catalog(self) -> None:
        if not self._catalog_path.is_file():
            return
        data = json.loads(self._catalog_path.read_text(encoding="utf-8"))
        self._graphs = [entry for entry in data.get("graphs", []) if isinstance(entry, dict) and entry.get("id")]
        self._active_id = data.get("active_id")

    def _write_catalog(self) -> None:
        payload = {"active_id": self._active_id, "graphs": self._graphs}
        staging = self._catalog_path.with_suffix(".json.tmp")
        staging.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        os.replace(staging, self._catalog_path)
