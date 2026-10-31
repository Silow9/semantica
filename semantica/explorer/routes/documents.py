"""Upload documents, inspect their parsed content, and build graph data from them."""

import asyncio
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from pydantic import BaseModel

from ..build_status import get_build_status
from ..dependencies import get_session
from ..document_graph import NER_METHODS, available_methods, build_document_graph, default_method
from ..documents_store import MAX_FILES_PER_REQUEST, DocumentStore
from ..model_settings import ModelSettingsStore
from ..session import GraphSession
from .model_settings import get_model_settings

router = APIRouter(tags=["Documents"])
_build_lock = asyncio.Semaphore(1)


class BuildGraphRequest(BaseModel):
    method: Optional[str] = None


def get_document_store(request: Request) -> DocumentStore:
    store = getattr(request.app.state, "document_store", None)
    if store is None:
        raise HTTPException(status_code=503, detail="Document store is not ready.")
    return store


@router.get("/api/documents")
async def list_documents(store: DocumentStore = Depends(get_document_store)):
    return {"documents": store.list_documents()}


@router.get("/api/documents/build-status")
async def build_status():
    return get_build_status().snapshot()


@router.get("/api/documents/build-options")
async def build_options(models: ModelSettingsStore = Depends(get_model_settings)):
    available = available_methods(models)
    return {
        "methods": [{"id": method, "available": available[method]} for method in NER_METHODS],
        "default": default_method(models),
    }


@router.get("/api/documents/{document_id}")
async def get_document(document_id: str, store: DocumentStore = Depends(get_document_store)):
    document = store.get(document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found.")
    return document


@router.delete("/api/documents/{document_id}")
async def delete_document(document_id: str, store: DocumentStore = Depends(get_document_store)):
    if not store.delete(document_id):
        raise HTTPException(status_code=404, detail="Document not found.")
    return {"status": "deleted", "id": document_id}


@router.post("/api/documents/upload")
async def upload_documents(
    files: list[UploadFile] = File(...),
    store: DocumentStore = Depends(get_document_store),
):
    if not files:
        raise HTTPException(status_code=422, detail="Choose at least one file.")
    if len(files) > MAX_FILES_PER_REQUEST:
        raise HTTPException(
            status_code=422,
            detail=f"Upload at most {MAX_FILES_PER_REQUEST} files at a time.",
        )
    documents = []
    for upload in files:
        data = await upload.read()
        documents.append(store.add(upload.filename or "upload", data))
    return {"documents": documents}


@router.post("/api/documents/{document_id}/build-graph")
async def build_graph(
    document_id: str,
    body: BuildGraphRequest,
    request: Request,
    store: DocumentStore = Depends(get_document_store),
    session: GraphSession = Depends(get_session),
    models: ModelSettingsStore = Depends(get_model_settings),
):
    document = store.get(document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found.")
    if document["status"] != "done":
        raise HTTPException(status_code=422, detail="Only successfully parsed documents can build a graph.")
    method = body.method or default_method(models)
    available = available_methods(models)
    if method not in available:
        raise HTTPException(status_code=422, detail=f"Unknown extraction method '{method}'.")
    if not available[method]:
        raise HTTPException(status_code=422, detail=f"Extraction method '{method}' is not available on this server.")
    library = getattr(request.app.state, "graph_library", None)
    target = library.active() if library is not None else None
    status = get_build_status()
    if not status.try_begin(
        document_id,
        str(document.get("name") or document_id),
        method,
        graph_name=target["name"] if target else None,
    ):
        current = status.snapshot()
        name = current.get("document_name") or "another document"
        raise HTTPException(
            status_code=409,
            detail=f"Another document is being built into the graph ({name}). Try again shortly.",
        )

    async def execute() -> dict:
        async with _build_lock:
            try:
                summary = await asyncio.to_thread(
                    build_document_graph, document, session, method, models, status
                )
                built_at = datetime.now(timezone.utc).isoformat()
                if library is not None:
                    await asyncio.to_thread(library.save_active)
                if target is not None:
                    summary = {**summary, "graph_id": target["id"], "graph_name": target["name"]}
                store.update(document_id, graph={**summary, "built_at": built_at})
                status.finish()
                return {**summary, "built_at": built_at}
            except Exception as exc:
                status.fail(str(exc))
                raise

    task = asyncio.create_task(execute())
    try:
        return await asyncio.shield(task)
    except asyncio.CancelledError:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
