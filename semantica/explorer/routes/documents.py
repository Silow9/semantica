"""Upload documents, inspect their parsed content, and build graph data from them."""

import asyncio
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel

from ..build_status import get_build_status
from ..dependencies import get_session
from ..document_graph import NER_METHODS, available_methods, build_document_graph, default_method
from ..documents_store import MAX_FILES_PER_REQUEST, DocumentLibraryError, DocumentStore
from ..graph_library import GraphLibraryError
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


def _library_error(exc: DocumentLibraryError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.detail)


def _checked_method(body: BuildGraphRequest, models: ModelSettingsStore) -> str:
    method = body.method or default_method(models)
    available = available_methods(models)
    if method not in available:
        raise HTTPException(status_code=422, detail=f"Unknown extraction method '{method}'.")
    if not available[method]:
        raise HTTPException(status_code=422, detail=f"Extraction method '{method}' is not available on this server.")
    return method


def _libraries_with_graphs(store: DocumentStore, graph_library: Any) -> dict:
    listing = store.list_libraries()
    names: dict[str, str] = {}
    if graph_library is not None:
        names = {graph["id"]: graph["name"] for graph in graph_library.list_graphs()["graphs"]}
    for library in listing["libraries"]:
        library["graph_name"] = names.get(library.get("graph_id"))
    return listing


def _graph_for_library(graph_library: Any, library: dict, store: DocumentStore) -> dict | None:
    if graph_library is None:
        return None
    graphs = graph_library.list_graphs()["graphs"]
    linked = next((graph for graph in graphs if graph["id"] == library.get("graph_id")), None)
    named = next((graph for graph in graphs if graph["name"] == library["name"]), None)
    chosen = linked or named or graph_library.create(library["name"])
    store.set_library_graph(library["id"], chosen["id"])
    return graph_library.activate(chosen["id"])


@router.get("/api/documents")
async def list_documents(library_id: str | None = None, store: DocumentStore = Depends(get_document_store)):
    try:
        return {"documents": store.list_documents(library_id)}
    except DocumentLibraryError as exc:
        raise _library_error(exc) from exc


@router.get("/api/document-libraries")
async def list_document_libraries(request: Request, store: DocumentStore = Depends(get_document_store)):
    return _libraries_with_graphs(store, getattr(request.app.state, "graph_library", None))


class CreateLibraryRequest(BaseModel):
    name: str


@router.post("/api/document-libraries")
async def create_document_library(body: CreateLibraryRequest, store: DocumentStore = Depends(get_document_store)):
    try:
        return store.create_library(body.name)
    except DocumentLibraryError as exc:
        raise _library_error(exc) from exc


@router.post("/api/document-libraries/{library_id}/activate")
async def activate_document_library(library_id: str, store: DocumentStore = Depends(get_document_store)):
    try:
        return store.activate_library(library_id)
    except DocumentLibraryError as exc:
        raise _library_error(exc) from exc


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
    library_id: str | None = Form(None),
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
    try:
        for upload in files:
            data = await upload.read()
            documents.append(store.add(upload.filename or "upload", data, library_id))
    except DocumentLibraryError as exc:
        raise _library_error(exc) from exc
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
    method = _checked_method(body, models)
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


@router.post("/api/document-libraries/{library_id}/build-graph")
async def build_library_graph(
    library_id: str,
    body: BuildGraphRequest,
    request: Request,
    store: DocumentStore = Depends(get_document_store),
    session: GraphSession = Depends(get_session),
    models: ModelSettingsStore = Depends(get_model_settings),
):
    try:
        documents = store.parsed_documents(library_id)
        libraries = store.list_libraries()["libraries"]
    except DocumentLibraryError as exc:
        raise _library_error(exc) from exc
    library = next((item for item in libraries if item["id"] == library_id), None)
    if library is None:
        raise HTTPException(status_code=404, detail="Document library not found.")
    if not documents:
        raise HTTPException(status_code=422, detail="This library has no parsed documents to build from.")
    method = _checked_method(body, models)
    graph_library = getattr(request.app.state, "graph_library", None)
    try:
        target = _graph_for_library(graph_library, library, store)
    except GraphLibraryError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    status = get_build_status()
    if not status.try_begin(
        documents[0]["id"],
        str(documents[0].get("name") or documents[0]["id"]),
        method,
        graph_name=target["name"] if target else None,
        library_id=library["id"],
        library_name=library["name"],
        documents_total=len(documents),
    ):
        current = status.snapshot()
        name = current.get("library_name") or current.get("document_name") or "another library"
        raise HTTPException(
            status_code=409,
            detail=f"Another document is being built into the graph ({name}). Try again shortly.",
        )

    async def execute() -> dict:
        async with _build_lock:
            try:
                totals = {
                    "method": method,
                    "documents": 0,
                    "chunks": 0,
                    "entities": 0,
                    "relationships": 0,
                    "nodes_added": 0,
                    "edges_added": 0,
                }
                for index, document in enumerate(documents):
                    status.focus_document(document["id"], str(document.get("name") or document["id"]), index)
                    summary = await asyncio.to_thread(
                        build_document_graph, document, session, method, models, status
                    )
                    built_at = datetime.now(timezone.utc).isoformat()
                    if target is not None:
                        summary = {**summary, "graph_id": target["id"], "graph_name": target["name"]}
                    store.update(document["id"], graph={**summary, "built_at": built_at})
                    totals["documents"] += 1
                    for key in ("chunks", "entities", "relationships", "nodes_added", "edges_added"):
                        totals[key] += int(summary.get(key) or 0)
                if graph_library is not None:
                    await asyncio.to_thread(graph_library.save_active)
                status.finish()
                return {
                    **totals,
                    "graph_id": target["id"] if target else None,
                    "graph_name": target["name"] if target else None,
                    "built_at": datetime.now(timezone.utc).isoformat(),
                }
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
