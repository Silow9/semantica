"""Configure the OpenAI-compatible LLM, embedding, and rerank endpoints."""

import asyncio
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from ..model_settings import MODEL_KINDS, ModelSettingsStore, probe

router = APIRouter(tags=["Model settings"])


class ModelEndpoint(BaseModel):
    base_url: str = ""
    model: str = ""
    api_key: Optional[str] = None


def get_model_settings(request: Request) -> ModelSettingsStore:
    store = getattr(request.app.state, "model_settings", None)
    if store is None:
        raise HTTPException(status_code=503, detail="Model settings are not ready.")
    return store


def _check_kind(kind: str) -> None:
    if kind not in MODEL_KINDS:
        raise HTTPException(status_code=404, detail=f"Unknown model kind '{kind}'.")


@router.get("/api/settings/models")
async def read_model_settings(store: ModelSettingsStore = Depends(get_model_settings)):
    return store.public_view()


@router.put("/api/settings/models/{kind}")
async def save_model_settings(
    kind: str,
    body: ModelEndpoint,
    store: ModelSettingsStore = Depends(get_model_settings),
):
    _check_kind(kind)
    try:
        store.update(kind, body.base_url, body.model, body.api_key)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return store.public_view()


@router.delete("/api/settings/models/{kind}")
async def clear_model_settings(kind: str, store: ModelSettingsStore = Depends(get_model_settings)):
    _check_kind(kind)
    store.clear(kind)
    return store.public_view()


@router.post("/api/settings/models/{kind}/test")
async def test_model_settings(
    kind: str,
    body: ModelEndpoint,
    store: ModelSettingsStore = Depends(get_model_settings),
):
    _check_kind(kind)
    saved = store.resolved(kind)
    candidate = {
        "base_url": body.base_url or saved["base_url"],
        "model": body.model or saved["model"],
        "api_key": saved["api_key"] if body.api_key is None else body.api_key,
    }
    return await asyncio.to_thread(probe, kind, candidate)
