"""List, create, switch, rename and delete the graphs kept by the Explorer."""

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from ..build_status import get_build_status
from ..graph_library import GraphLibrary, GraphLibraryError

router = APIRouter(tags=["Graphs"])


class CreateGraphRequest(BaseModel):
    name: str
    activate: bool = True


class RenameGraphRequest(BaseModel):
    name: str


def get_graph_library(request: Request) -> GraphLibrary:
    library = getattr(request.app.state, "graph_library", None)
    if library is None:
        raise HTTPException(status_code=503, detail="Graph library is not ready.")
    return library


def _refuse_while_building() -> None:
    job = get_build_status().snapshot()
    if job["active"]:
        name = job.get("document_name") or "a document"
        raise HTTPException(
            status_code=409,
            detail=f"A document ({name}) is being built into the current graph. Wait for it to finish.",
        )


def _call(action, *args):
    try:
        return action(*args)
    except GraphLibraryError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.get("/api/graphs")
async def list_graphs(library: GraphLibrary = Depends(get_graph_library)):
    return library.list_graphs()


@router.post("/api/graphs")
async def create_graph(body: CreateGraphRequest, library: GraphLibrary = Depends(get_graph_library)):
    if body.activate:
        _refuse_while_building()
    created = _call(library.create, body.name)
    if body.activate:
        created = _call(library.activate, created["id"])
    return created


@router.post("/api/graphs/{graph_id}/activate")
async def activate_graph(graph_id: str, library: GraphLibrary = Depends(get_graph_library)):
    _refuse_while_building()
    return _call(library.activate, graph_id)


@router.put("/api/graphs/{graph_id}")
async def rename_graph(
    graph_id: str,
    body: RenameGraphRequest,
    library: GraphLibrary = Depends(get_graph_library),
):
    return _call(library.rename, graph_id, body.name)


@router.delete("/api/graphs/{graph_id}")
async def delete_graph(graph_id: str, library: GraphLibrary = Depends(get_graph_library)):
    _call(library.delete, graph_id)
    return {"status": "deleted", "id": graph_id}
