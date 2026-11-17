"""Build graph nodes and edges from a parsed document with GraphBuilder."""

from __future__ import annotations

import importlib.util
import re
from html import unescape
from typing import Any

from .model_settings import ModelSettingsStore
from .session import GraphSession

CHUNK_CHARS = 2000
NER_METHODS = ("llm", "ml", "pattern")
_TAG = re.compile(r"<[^>]+>")
_ROW_END = re.compile(r"</(?:tr|caption)\s*>", re.IGNORECASE)
_CELL_END = re.compile(r"</t[dh]\s*>", re.IGNORECASE)


def llm_extractor_config(models: ModelSettingsStore) -> dict[str, str]:
    settings = models.resolved("llm")
    return {
        "provider": "openai",
        "llm_model": settings["model"],
        "base_url": settings["base_url"],
        # The OpenAI client refuses to start without a key; local servers ignore it.
        "api_key": settings["api_key"] or "EMPTY",
    }


def available_methods(models: ModelSettingsStore) -> dict[str, bool]:
    return {
        "llm": models.is_configured("llm") and _installed("openai"),
        "ml": _installed("spacy"),
        "pattern": True,
    }


def _installed(package: str) -> bool:
    return importlib.util.find_spec(package) is not None


def default_method(models: ModelSettingsStore) -> str:
    available = available_methods(models)
    return next(method for method in NER_METHODS if available[method])


def document_chunks(items: list[dict[str, Any]], limit: int = CHUNK_CHARS) -> list[str]:
    chunks: list[str] = []
    current: list[str] = []
    size = 0
    for item in items:
        text = _item_text(item)
        if not text:
            continue
        for piece in _split_long(text, limit):
            if current and size + len(piece) > limit:
                chunks.append("\n\n".join(current))
                current, size = [], 0
            current.append(piece)
            size += len(piece) + 2
    if current:
        chunks.append("\n\n".join(current))
    return chunks


def _item_text(item: dict[str, Any]) -> str:
    text = str(item.get("text") or "")
    if item.get("doc_type_kwd") == "table":
        text = _ROW_END.sub("\n", text)
        text = _CELL_END.sub(" | ", text)
        text = unescape(_TAG.sub("", text))
    return text.strip()


def _split_long(text: str, limit: int) -> list[str]:
    if len(text) <= limit:
        return [text]
    return [text[start:start + limit] for start in range(0, len(text), limit)]


def build_document_graph(
    document: dict[str, Any],
    session: GraphSession,
    method: str,
    models: ModelSettingsStore | None = None,
    reporter: Any = None,
) -> dict[str, Any]:
    from ..kg.graph_builder import GraphBuilder

    chunks = document_chunks(document.get("items") or [])
    if not chunks:
        raise ValueError("The document has no text to extract from.")

    def on_stage(stage: str, **info: Any) -> None:
        if reporter is not None:
            reporter.update(stage, **info)

    on_stage("extract_entities", processed=0, total=len(chunks), entities=0, relationships=0, triplets=0)
    extractor_config = llm_extractor_config(models) if method == "llm" and models else {}
    relation_method = "llm" if method == "llm" else "pattern"
    builder = GraphBuilder(
        merge_entities=True,
        entity_resolution_strategy="exact",
        resolve_conflicts=False,
        **extractor_config,
    )
    result = builder.build(
        [{"text": chunk} for chunk in chunks],
        extract_relations=True,
        ner_method=method,
        relation_method=relation_method,
        triplet_method=relation_method,
        stage_callback=on_stage,
        chunk_total=len(chunks),
    )
    on_stage(
        "write",
        processed=len(chunks),
        total=len(chunks),
        entities=len(result.get("entities") or []),
        relationships=len(result.get("relationships") or []),
    )
    nodes, edges = _to_graph_records(document, result, session)
    nodes_added, edges_added = session.add_nodes_and_edges(nodes, edges)
    return {
        "method": method,
        "chunks": len(chunks),
        "entities": len(result.get("entities") or []),
        "relationships": len(result.get("relationships") or []),
        "nodes_added": nodes_added,
        "edges_added": edges_added,
        "document_node_id": f"document:{document['id']}",
    }


def _to_graph_records(
    document: dict[str, Any],
    result: dict[str, Any],
    session: GraphSession,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    document_node_id = f"document:{document['id']}"
    source = {"document_id": document["id"], "source_document": document["name"]}
    nodes: list[dict[str, Any]] = [
        {
            "id": document_node_id,
            "type": "document",
            "content": document["name"],
            "properties": {
                **source,
                "label": document["name"],
                "format": document.get("format"),
                "parser": document.get("parser"),
            },
        }
    ]
    edges: list[dict[str, Any]] = []
    id_map: dict[Any, str] = {}

    for entity in result.get("entities") or []:
        if not isinstance(entity, dict):
            continue
        name = str(entity.get("name") or entity.get("text") or entity.get("id") or "").strip()
        if not name:
            continue
        node_id = f"entity:{name.lower()}"
        for key in ("id", "entity_id", "name"):
            if entity.get(key) is not None:
                id_map[entity[key]] = node_id
        if any(node["id"] == node_id for node in nodes):
            continue
        nodes.append(
            {
                "id": node_id,
                "type": str(entity.get("type") or "entity").lower(),
                "content": name,
                "properties": {
                    "label": name,
                    "entity_type": entity.get("type"),
                    "confidence": entity.get("confidence"),
                    "source_documents": _merged_sources(session, node_id, document["name"]),
                },
            }
        )
        edges.append(
            {
                "source": document_node_id,
                "target": node_id,
                "type": "mentions",
                "properties": dict(source),
            }
        )

    for relationship in result.get("relationships") or []:
        if not isinstance(relationship, dict):
            continue
        source_id = id_map.get(relationship.get("source"))
        target_id = id_map.get(relationship.get("target"))
        if not source_id or not target_id or source_id == target_id:
            continue
        edges.append(
            {
                "source": source_id,
                "target": target_id,
                "type": str(relationship.get("type") or "related_to"),
                "properties": {
                    **source,
                    "confidence": relationship.get("confidence"),
                },
            }
        )
    return nodes, edges


def _merged_sources(session: GraphSession, node_id: str, document_name: str) -> list[str]:
    existing = session.graph.nodes.get(node_id)
    previous = []
    if existing is not None:
        previous = list((getattr(existing, "properties", None) or {}).get("source_documents") or [])
    if document_name not in previous:
        previous.append(document_name)
    return previous
