"""In-memory progress for a document being built into the graph."""

from __future__ import annotations

import threading
from datetime import datetime, timezone
from typing import Any

_STEPS = ("ingest", "parse", "extract", "build", "write")
_STEP_FOR_STAGE = {
    "ingest": "ingest",
    "parse": "parse",
    "extract_entities": "extract",
    "extract_relations": "extract",
    "extract_triplets": "extract",
    "build": "build",
    "write": "write",
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _steps(job: dict[str, Any]) -> list[dict[str, str]]:
    if job.get("finished_at") and not job.get("error"):
        return [{"id": step, "state": "done"} for step in _STEPS]
    current = _STEP_FOR_STAGE.get(str(job.get("stage") or ""), "extract")
    failed = bool(job.get("error")) and not job.get("active")
    states: list[dict[str, str]] = []
    passed_current = False
    for step in _STEPS:
        if step == current:
            state = "failed" if failed else "running" if job.get("active") else "done"
            passed_current = True
        elif passed_current:
            state = "pending"
        else:
            state = "done"
        states.append({"id": step, "state": state})
    return states


class BuildStatus:
    """One build at a time. The record stays readable after the build ends."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._job: dict[str, Any] | None = None

    def try_begin(
        self,
        document_id: str,
        document_name: str,
        method: str,
        graph_name: str | None = None,
    ) -> bool:
        with self._lock:
            if self._job and self._job["active"]:
                return False
            self._job = {
                "active": True,
                "document_id": document_id,
                "document_name": document_name,
                "graph_name": graph_name,
                "method": method,
                "stage": "extract_entities",
                "processed": 0,
                "total": 0,
                "entities": 0,
                "relationships": 0,
                "triplets": 0,
                "error": None,
                "started_at": _now(),
                "finished_at": None,
            }
            return True

    def update(self, stage: str, **info: Any) -> None:
        with self._lock:
            job = self._job
            if job is None or not job["active"]:
                return
            if stage in _STEP_FOR_STAGE:
                job["stage"] = stage
            for key in ("processed", "total", "entities", "relationships", "triplets"):
                value = info.get(key)
                if isinstance(value, int):
                    job[key] = value

    def finish(self) -> None:
        with self._lock:
            if self._job is None:
                return
            self._job["active"] = False
            self._job["stage"] = "write"
            self._job["error"] = None
            self._job["finished_at"] = _now()

    def fail(self, message: str) -> None:
        with self._lock:
            if self._job is None:
                return
            self._job["active"] = False
            self._job["error"] = message
            self._job["finished_at"] = _now()

    def reset(self) -> None:
        with self._lock:
            self._job = None

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            if self._job is None:
                return {
                    "active": False,
                    "document_id": None,
                    "document_name": None,
                    "graph_name": None,
                    "method": None,
                    "stage": None,
                    "steps": [],
                    "processed": 0,
                    "total": 0,
                    "entities": 0,
                    "relationships": 0,
                    "triplets": 0,
                    "error": None,
                    "started_at": None,
                    "finished_at": None,
                }
            job = dict(self._job)
        job["steps"] = _steps(job)
        return job


_status = BuildStatus()


def get_build_status() -> BuildStatus:
    return _status
