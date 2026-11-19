"""On-disk catalog of uploaded documents and their parser output."""

from __future__ import annotations

import json
import os
import re
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .ragflow_parser import parse_bytes

MAX_UPLOAD_BYTES = 50 * 1024 * 1024
MAX_FILES_PER_REQUEST = 20
MAX_LIBRARY_NAME = 80
DEFAULT_LIBRARY_NAME = "集成库"
_DOCUMENT_ID = re.compile(r"^[0-9a-f]{32}$")


class DocumentLibraryError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def _clean_library_name(name: Any) -> str:
    cleaned = " ".join(str(name or "").split())
    if not cleaned:
        raise DocumentLibraryError(422, "Library name is required.")
    if len(cleaned) > MAX_LIBRARY_NAME:
        raise DocumentLibraryError(422, f"Library name must be at most {MAX_LIBRARY_NAME} characters.")
    return cleaned


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def resolve_document_root() -> Path:
    configured = os.environ.get("SEMANTICA_DATA_DIR", "").strip()
    if configured:
        return Path(configured) / "documents"
    return Path.home() / ".semantica" / "explorer" / "documents"


class DocumentStore:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self._catalog_path = self.root / "catalog.json"
        self._libraries_path = self.root / "libraries.json"
        self._lock = threading.Lock()
        self._active_library_id: str | None = None
        self._libraries: list[dict[str, Any]] = []

    def add(self, filename: str, data: bytes, library_id: str | None = None) -> dict[str, Any]:
        safe_name = Path(filename or "upload").name.replace("\x00", "")[:255] or "upload"
        if len(data) > MAX_UPLOAD_BYTES:
            parsed = {
                "name": safe_name,
                "size": len(data),
                "parser": "",
                "format": Path(safe_name).suffix.lower().lstrip("."),
                "encoding": "",
                "items": [],
                "warnings": [],
                "error": f"Upload exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB limit.",
            }
        else:
            parsed = parse_bytes(safe_name, data)
            parsed["size"] = len(data)
        document_id = uuid.uuid4().hex
        record = {
            "id": document_id,
            "name": parsed["name"],
            "size": parsed["size"],
            "parser": parsed["parser"],
            "format": parsed["format"],
            "encoding": parsed["encoding"],
            "status": "failed" if parsed["error"] else "done",
            "item_count": len(parsed["items"]),
            "warnings": parsed["warnings"],
            "error": parsed["error"],
        }
        with self._lock:
            self._ensure_libraries_locked()
            chosen = library_id or self._active_library_id
            if self._library_entry(chosen) is None:
                raise DocumentLibraryError(404, "Document library not found.")
            record["library_id"] = chosen
        target = self.root / document_id
        target.mkdir(parents=True, exist_ok=True)
        (target / "source.bin").write_bytes(data)
        (target / "parsed.json").write_text(
            json.dumps({"items": parsed["items"]}, ensure_ascii=False),
            encoding="utf-8",
        )
        with self._lock:
            catalog = self._read_catalog()
            catalog.append(record)
            self._write_catalog(catalog)
        return record

    def list_documents(self, library_id: str | None = None) -> list[dict[str, Any]]:
        with self._lock:
            self._ensure_libraries_locked()
            if library_id is not None and self._library_entry(library_id) is None:
                raise DocumentLibraryError(404, "Document library not found.")
            rows = self._read_catalog()
            if library_id is not None:
                rows = [row for row in rows if row.get("library_id") == library_id]
            return list(reversed(rows))

    def parsed_documents(self, library_id: str) -> list[dict[str, Any]]:
        with self._lock:
            self._ensure_libraries_locked()
            if self._library_entry(library_id) is None:
                raise DocumentLibraryError(404, "Document library not found.")
            rows = [
                row for row in self._read_catalog()
                if row.get("library_id") == library_id and row.get("status") == "done"
            ]
        return [document for row in rows if (document := self.get(row["id"])) is not None]

    def list_libraries(self) -> dict[str, Any]:
        with self._lock:
            self._ensure_libraries_locked()
            counts: dict[str, int] = {}
            for row in self._read_catalog():
                key = str(row.get("library_id") or "")
                counts[key] = counts.get(key, 0) + 1
            libraries = [self._public_library(entry, counts.get(entry["id"], 0)) for entry in self._libraries]
            return {"active_id": self._active_library_id, "libraries": libraries}

    def create_library(self, name: Any) -> dict[str, Any]:
        cleaned = _clean_library_name(name)
        with self._lock:
            self._ensure_libraries_locked()
            if any(entry["name"] == cleaned for entry in self._libraries):
                raise DocumentLibraryError(409, f"A library named '{cleaned}' already exists.")
            entry = self._new_library(cleaned)
            self._active_library_id = entry["id"]
            self._write_libraries()
            return self._public_library(entry, 0)

    def activate_library(self, library_id: str) -> dict[str, Any]:
        with self._lock:
            self._ensure_libraries_locked()
            entry = self._library_entry(library_id)
            if entry is None:
                raise DocumentLibraryError(404, "Document library not found.")
            self._active_library_id = entry["id"]
            self._write_libraries()
            count = sum(1 for row in self._read_catalog() if row.get("library_id") == entry["id"])
            return self._public_library(entry, count)

    def set_library_graph(self, library_id: str, graph_id: str) -> None:
        with self._lock:
            self._ensure_libraries_locked()
            entry = self._library_entry(library_id)
            if entry is None:
                raise DocumentLibraryError(404, "Document library not found.")
            entry["graph_id"] = graph_id
            entry["updated_at"] = _now()
            self._write_libraries()

    def get(self, document_id: str) -> dict[str, Any] | None:
        if not _DOCUMENT_ID.fullmatch(document_id):
            return None
        with self._lock:
            record = next((item for item in self._read_catalog() if item["id"] == document_id), None)
        if record is None:
            return None
        parsed_path = self.root / document_id / "parsed.json"
        items: list[Any] = []
        if parsed_path.is_file():
            items = json.loads(parsed_path.read_text(encoding="utf-8")).get("items", [])
        return {**record, "items": items}

    def update(self, document_id: str, **fields: Any) -> dict[str, Any] | None:
        if not _DOCUMENT_ID.fullmatch(document_id):
            return None
        with self._lock:
            catalog = self._read_catalog()
            record = next((item for item in catalog if item["id"] == document_id), None)
            if record is None:
                return None
            record.update(fields)
            self._write_catalog(catalog)
            return dict(record)

    def delete(self, document_id: str) -> bool:
        if not _DOCUMENT_ID.fullmatch(document_id):
            return False
        with self._lock:
            catalog = self._read_catalog()
            kept = [item for item in catalog if item["id"] != document_id]
            if len(kept) == len(catalog):
                return False
            self._write_catalog(kept)
        folder = self.root / document_id
        if folder.is_dir():
            for child in folder.iterdir():
                child.unlink(missing_ok=True)
            folder.rmdir()
        return True

    def _read_catalog(self) -> list[dict[str, Any]]:
        if not self._catalog_path.is_file():
            return []
        return json.loads(self._catalog_path.read_text(encoding="utf-8"))

    def _write_catalog(self, catalog: list[dict[str, Any]]) -> None:
        self._catalog_path.write_text(json.dumps(catalog, ensure_ascii=False), encoding="utf-8")

    def _ensure_libraries_locked(self) -> None:
        if not self._libraries:
            self._read_libraries()
        if not self._libraries:
            entry = self._new_library(DEFAULT_LIBRARY_NAME)
            self._active_library_id = entry["id"]
        active = self._library_entry(self._active_library_id)
        if active is None:
            active = self._libraries[0]
            self._active_library_id = active["id"]
        changed = False
        catalog = self._read_catalog()
        for row in catalog:
            if row.get("library_id"):
                continue
            row["library_id"] = active["id"]
            changed = True
        if changed:
            self._write_catalog(catalog)
        self._write_libraries()

    def _new_library(self, name: str) -> dict[str, Any]:
        now = _now()
        entry = {
            "id": uuid.uuid4().hex,
            "name": name,
            "graph_id": None,
            "created_at": now,
            "updated_at": now,
        }
        self._libraries.append(entry)
        return entry

    def _library_entry(self, library_id: str | None) -> dict[str, Any] | None:
        if not library_id or not _DOCUMENT_ID.fullmatch(library_id):
            return None
        return next((entry for entry in self._libraries if entry["id"] == library_id), None)

    def _public_library(self, entry: dict[str, Any], document_count: int) -> dict[str, Any]:
        return {
            "id": entry["id"],
            "name": entry["name"],
            "graph_id": entry.get("graph_id"),
            "document_count": document_count,
            "active": entry["id"] == self._active_library_id,
            "created_at": entry.get("created_at"),
            "updated_at": entry.get("updated_at"),
        }

    def _read_libraries(self) -> None:
        if not self._libraries_path.is_file():
            return
        data = json.loads(self._libraries_path.read_text(encoding="utf-8"))
        self._libraries = [
            entry for entry in data.get("libraries", [])
            if isinstance(entry, dict) and _DOCUMENT_ID.fullmatch(str(entry.get("id") or ""))
        ]
        self._active_library_id = data.get("active_id")

    def _write_libraries(self) -> None:
        payload = {"active_id": self._active_library_id, "libraries": self._libraries}
        staging = self._libraries_path.with_suffix(".json.tmp")
        staging.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        os.replace(staging, self._libraries_path)
