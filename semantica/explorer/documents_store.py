"""On-disk catalog of uploaded documents and their parser output."""

from __future__ import annotations

import json
import os
import re
import threading
import uuid
from pathlib import Path
from typing import Any

from .ragflow_parser import parse_bytes

MAX_UPLOAD_BYTES = 50 * 1024 * 1024
MAX_FILES_PER_REQUEST = 20
_DOCUMENT_ID = re.compile(r"^[0-9a-f]{32}$")


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
        self._lock = threading.Lock()

    def add(self, filename: str, data: bytes) -> dict[str, Any]:
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

    def list_documents(self) -> list[dict[str, Any]]:
        with self._lock:
            return list(reversed(self._read_catalog()))

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
