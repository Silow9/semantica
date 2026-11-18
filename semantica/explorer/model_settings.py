"""OpenAI-compatible LLM, embedding, and rerank endpoints configured from the Explorer."""

from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx

MODEL_KINDS = ("llm", "embedding", "rerank")
_FIELDS = ("base_url", "model", "api_key")
REQUEST_TIMEOUT = 30.0


def resolve_settings_path() -> Path:
    configured = os.environ.get("SEMANTICA_DATA_DIR", "").strip()
    root = Path(configured) if configured else Path.home() / ".semantica" / "explorer"
    return root / "settings" / "models.json"


def _env_defaults(kind: str) -> dict[str, str]:
    prefix = f"SEMANTICA_{kind.upper()}_"
    values = {field: os.environ.get(prefix + field.upper(), "").strip() for field in _FIELDS}
    return {field: value for field, value in values.items() if value}


def validate_base_url(base_url: str) -> str:
    cleaned = base_url.strip().rstrip("/")
    parsed = urlparse(cleaned)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError("Base URL must be an http(s) address, e.g. http://localhost:8000/v1.")
    return cleaned


class ModelSettingsStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    def resolved(self, kind: str) -> dict[str, str]:
        saved = self._read().get(kind) or {}
        merged = {**_env_defaults(kind), **{key: value for key, value in saved.items() if value}}
        return {field: merged.get(field, "") for field in _FIELDS}

    def is_configured(self, kind: str) -> bool:
        settings = self.resolved(kind)
        return bool(settings["base_url"] and settings["model"])

    def public_view(self) -> dict[str, Any]:
        saved = self._read()
        view = {}
        for kind in MODEL_KINDS:
            settings = self.resolved(kind)
            view[kind] = {
                "base_url": settings["base_url"],
                "model": settings["model"],
                "has_api_key": bool(settings["api_key"]),
                "configured": bool(settings["base_url"] and settings["model"]),
                "source": "saved" if saved.get(kind) else ("env" if _env_defaults(kind) else "none"),
            }
        return view

    def update(self, kind: str, base_url: str, model: str, api_key: str | None) -> None:
        cleaned_url = validate_base_url(base_url) if base_url.strip() else ""
        with self._lock:
            data = self._read()
            current = data.get(kind) or {}
            data[kind] = {
                "base_url": cleaned_url,
                "model": model.strip(),
                "api_key": current.get("api_key", "") if api_key is None else api_key.strip(),
            }
            self._write(data)

    def clear(self, kind: str) -> None:
        with self._lock:
            data = self._read()
            data.pop(kind, None)
            self._write(data)

    def _read(self) -> dict[str, Any]:
        if not self.path.is_file():
            return {}
        return json.loads(self.path.read_text(encoding="utf-8"))

    def _write(self, data: dict[str, Any]) -> None:
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(self.path)


def _headers(settings: dict[str, str]) -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if settings.get("api_key"):
        headers["Authorization"] = f"Bearer {settings['api_key']}"
    return headers


def _post(settings: dict[str, str], path: str, payload: dict[str, Any], timeout: float | None = None) -> dict[str, Any]:
    url = f"{validate_base_url(settings['base_url'])}/{path}"
    response = httpx.post(url, json=payload, headers=_headers(settings), timeout=timeout or REQUEST_TIMEOUT)
    if response.status_code >= 400:
        raise RuntimeError(f"{url} returned HTTP {response.status_code}: {response.text[:300]}")
    return response.json()


def _message_text(message: dict[str, Any]) -> str:
    content = message.get("content")
    if isinstance(content, list):
        content = "".join(part.get("text", "") if isinstance(part, dict) else str(part) for part in content)
    text = str(content or "").strip()
    if text:
        return text
    # Thinking models can spend the whole budget in reasoning_content and leave content empty.
    return str(message.get("reasoning_content") or "").strip()


def chat(
    settings: dict[str, str],
    prompt: str,
    max_tokens: int = 256,
    system: str | None = None,
    extra: dict[str, Any] | None = None,
    timeout: float | None = None,
) -> str:
    messages = [{"role": "system", "content": system}] if system else []
    messages.append({"role": "user", "content": prompt})
    payload: dict[str, Any] = {"model": settings["model"], "messages": messages, "max_tokens": max_tokens}
    if extra:
        payload.update(extra)
    body = _post(settings, "chat/completions", payload, timeout=timeout)
    return _message_text(body["choices"][0]["message"])


def embed(settings: dict[str, str], texts: list[str]) -> list[list[float]]:
    body = _post(settings, "embeddings", {"model": settings["model"], "input": texts})
    rows = sorted(body["data"], key=lambda row: row.get("index", 0))
    return [row["embedding"] for row in rows]


def rerank(settings: dict[str, str], query: str, documents: list[str]) -> list[dict[str, Any]]:
    body = _post(
        settings,
        "rerank",
        {"model": settings["model"], "query": query, "documents": documents, "top_n": len(documents)},
    )
    results = body.get("results") or body.get("data") or []
    return [
        {"index": row["index"], "score": row.get("relevance_score", row.get("score"))}
        for row in results
    ]


def _probe_llm(settings: dict[str, str]) -> str:
    reply = chat(settings, "Reply with the single word: pong", max_tokens=8)
    return f"reply: {reply.strip()[:60]}"


def _probe_embedding(settings: dict[str, str]) -> str:
    vectors = embed(settings, ["semantica"])
    return f"dimension: {len(vectors[0])}"


def _probe_rerank(settings: dict[str, str]) -> str:
    results = rerank(settings, "knowledge graph", ["A knowledge graph links entities.", "The weather is sunny."])
    best = max(results, key=lambda row: row["score"] or 0)
    return f"top document: #{best['index']}"


PROBES = {"llm": _probe_llm, "embedding": _probe_embedding, "rerank": _probe_rerank}


def probe(kind: str, settings: dict[str, str]) -> dict[str, Any]:
    if not (settings.get("base_url") and settings.get("model")):
        return {"ok": False, "detail": "Base URL and model are required."}
    started = time.perf_counter()
    try:
        detail = PROBES[kind](settings)
    except Exception as exc:
        return {"ok": False, "detail": str(exc)[:400]}
    return {"ok": True, "detail": detail, "latency_ms": round((time.perf_counter() - started) * 1000)}
