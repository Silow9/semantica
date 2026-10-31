"""Upload and parse documents through the embedded RAGFlow parser contract."""

import io
import sys
import zipfile

import pytest

from semantica.explorer.ragflow_parser import parse_bytes


def _docx(text: str) -> bytes:
    document = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f"<w:body><w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:body></w:document>"
    )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as package:
        package.writestr("word/document.xml", document)
    return buffer.getvalue()


def test_text_markdown_csv_and_json_follow_ragflow_item_shape():
    text = parse_bytes("notes.txt", b"alpha\r\nbeta")
    assert text["parser"] == "TextParser"
    assert text["items"] == [{"text": "alpha\nbeta", "doc_type_kwd": "text"}]

    csv_doc = parse_bytes("people.csv", "name;city\nAda;London\n".encode())
    assert csv_doc["parser"] == "CSVParser"
    assert csv_doc["items"][0]["doc_type_kwd"] == "table"
    assert "Ada" in csv_doc["items"][0]["text"]

    payload = parse_bytes("rows.json", b'[{"name": "Ada"}, {"name": "Grace"}]')
    assert payload["parser"] == "JSONParser"
    assert len(payload["items"]) == 2
    assert payload["items"][0]["doc_type_kwd"] == "text"


def test_docx_reads_ooxml_paragraphs():
    parsed = parse_bytes("brief.docx", _docx("Quarterly note"))
    assert parsed["error"] is None
    assert parsed["parser"] == "DOCXParser"
    assert parsed["items"][0]["text"] == "Quarterly note"


def test_pdf_reports_missing_pdfplumber(monkeypatch):
    monkeypatch.setitem(sys.modules, "pdfplumber", None)
    parsed = parse_bytes("scan.pdf", b"%PDF-1.4")
    assert parsed["parser"] == "PDFParser"
    assert "pdfplumber" in parsed["error"]


def test_legacy_office_reports_missing_native_engine():
    parsed = parse_bytes("old.doc", b"not a real doc")
    assert parsed["parser"] == "DOCParser"
    assert "office_oxide" in parsed["error"]


def test_store_records_parsed_document_and_deletes_it(tmp_path, monkeypatch):
    monkeypatch.setenv("SEMANTICA_DATA_DIR", str(tmp_path))
    from semantica.explorer.documents_store import DocumentStore, resolve_document_root

    store = DocumentStore(resolve_document_root())
    record = store.add("notes.md", b"# Title\n\nA paragraph.")
    assert record["status"] == "done"
    assert record["parser"] == "MarkdownParser"
    detail = store.get(record["id"])
    assert detail is not None
    assert any("Title" in item["text"] for item in detail["items"])
    assert store.delete(record["id"]) is True
    assert store.get(record["id"]) is None


def test_upload_lists_and_deletes_a_document(tmp_path, monkeypatch):
    pytest.importorskip("fastapi")
    from semantica.context.context_graph import ContextGraph
    from semantica.explorer.app import create_app
    from semantica.explorer.session import GraphSession
    from starlette.testclient import TestClient

    monkeypatch.setenv("SEMANTICA_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("SEMANTICA_ALLOW_ANONYMOUS", "true")
    monkeypatch.delenv("ALLOWED_ORIGINS", raising=False)
    monkeypatch.delenv("EXPLORER_CORS_ORIGINS", raising=False)
    graph = ContextGraph(advanced_analytics=False)
    app = create_app(session=GraphSession(graph))
    with TestClient(app) as client:
        response = client.post(
            "/api/documents/upload",
            files=[("files", ("notes.md", b"# Title\n\nA paragraph.", "text/markdown"))],
        )
        assert response.status_code == 200
        document = response.json()["documents"][0]
        assert document["status"] == "done"
        assert document["parser"] == "MarkdownParser"
        assert document["item_count"] >= 1

        listed = client.get("/api/documents")
        assert listed.status_code == 200
        assert listed.json()["documents"][0]["id"] == document["id"]

        detail = client.get(f"/api/documents/{document['id']}")
        assert detail.status_code == 200
        assert any("Title" in item["text"] for item in detail.json()["items"])

        deleted = client.delete(f"/api/documents/{document['id']}")
        assert deleted.status_code == 200
        assert client.get(f"/api/documents/{document['id']}").status_code == 404


def test_document_chunks_flatten_tables_and_respect_limit():
    from semantica.explorer.document_graph import document_chunks

    items = [
        {"text": "<table><tr><th>name</th><th>city</th></tr><tr><td>Ada</td><td>London</td></tr></table>", "doc_type_kwd": "table"},
        {"text": "x" * 25, "doc_type_kwd": "text"},
        {"text": "   ", "doc_type_kwd": "text"},
    ]
    chunks = document_chunks(items, limit=20)
    assert chunks[0].startswith("name | city |")
    assert "<" not in chunks[0]
    assert all(len(chunk) <= 20 for chunk in chunks)
    assert "".join(chunks).count("x") == 25


def test_build_document_graph_writes_entities_with_document_provenance(tmp_path, monkeypatch):
    from semantica.context.context_graph import ContextGraph
    from semantica.explorer.document_graph import build_document_graph
    from semantica.explorer.documents_store import DocumentStore
    from semantica.explorer.session import GraphSession

    store = DocumentStore(tmp_path)
    record = store.add("people.txt", b"Ada Lovelace worked with Charles Babbage in London.")
    document = store.get(record["id"])
    session = GraphSession(ContextGraph(advanced_analytics=False))
    seen: list[str] = []

    class Recorder:
        def update(self, stage: str, **info: object) -> None:
            seen.append(stage)

    summary = build_document_graph(document, session, "pattern", reporter=Recorder())

    assert seen[0] == "extract_entities"
    assert "extract_relations" in seen
    assert "extract_triplets" in seen
    assert "build" in seen
    assert seen[-1] == "write"

    document_node = session.graph.nodes[f"document:{record['id']}"]
    assert document_node.properties["source_document"] == "people.txt"
    assert summary["entities"] > 0
    assert summary["nodes_added"] == summary["entities"] + 1
    entity_ids = [node_id for node_id in session.graph.nodes if node_id.startswith("entity:")]
    assert entity_ids
    entity = session.graph.nodes[entity_ids[0]]
    assert entity.properties["source_documents"] == ["people.txt"]
    mentions = [edge for edge in session.graph.find_edges() if edge.get("type") == "mentions"]
    assert len(mentions) == len(entity_ids)


def test_build_graph_route_reports_unavailable_method(tmp_path, monkeypatch):
    pytest.importorskip("fastapi")
    from semantica.context.context_graph import ContextGraph
    from semantica.explorer.app import create_app
    from semantica.explorer.session import GraphSession
    from starlette.testclient import TestClient

    monkeypatch.setenv("SEMANTICA_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("SEMANTICA_ALLOW_ANONYMOUS", "true")
    monkeypatch.delenv("SEMANTICA_LLM_BASE_URL", raising=False)
    monkeypatch.delenv("SEMANTICA_LLM_MODEL", raising=False)
    from semantica.explorer.build_status import get_build_status

    get_build_status().reset()
    app = create_app(session=GraphSession(ContextGraph(advanced_analytics=False)))
    with TestClient(app) as client:
        options = client.get("/api/documents/build-options").json()
        assert {"id": "llm", "available": False} in options["methods"]
        assert {"id": "pattern", "available": True} in options["methods"]

        uploaded = client.post(
            "/api/documents/upload",
            files=[("files", ("people.txt", b"Ada Lovelace met Charles Babbage.", "text/plain"))],
        ).json()["documents"][0]
        refused = client.post(f"/api/documents/{uploaded['id']}/build-graph", json={"method": "llm"})
        assert refused.status_code == 422

        built = client.post(f"/api/documents/{uploaded['id']}/build-graph", json={"method": "pattern"})
        assert built.status_code == 200
        assert built.json()["nodes_added"] >= 1
        active = client.get("/api/graphs").json()
        assert built.json()["graph_id"] == active["active_id"]
        assert built.json()["graph_name"] == active["graphs"][0]["name"]
        assert active["graphs"][0]["node_count"] == built.json()["nodes_added"]
        assert client.get(f"/api/documents/{uploaded['id']}").json()["graph"]["method"] == "pattern"
        finished = client.get("/api/documents/build-status").json()
        assert finished["active"] is False
        assert finished["document_name"] == "people.txt"
        assert [step["state"] for step in finished["steps"]] == ["done", "done", "done", "done", "done"]
        assert finished["error"] is None


def test_build_status_stays_visible_while_a_document_is_building(tmp_path, monkeypatch):
    pytest.importorskip("fastapi")
    from semantica.context.context_graph import ContextGraph
    from semantica.explorer.app import create_app
    from semantica.explorer.build_status import get_build_status
    from semantica.explorer.session import GraphSession
    from starlette.testclient import TestClient

    monkeypatch.setenv("SEMANTICA_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("SEMANTICA_ALLOW_ANONYMOUS", "true")
    status = get_build_status()
    status.reset()
    app = create_app(session=GraphSession(ContextGraph(advanced_analytics=False)))
    try:
        with TestClient(app) as client:
            assert client.get("/api/documents/build-status").json()["active"] is False
            uploaded = client.post(
                "/api/documents/upload",
                files=[("files", ("report.txt", b"Ada Lovelace met Charles Babbage.", "text/plain"))],
            ).json()["documents"][0]
            assert status.try_begin(uploaded["id"], uploaded["name"], "llm")
            status.update("extract_relations", processed=1, total=4, entities=3, relationships=1, triplets=0)
            live = client.get("/api/documents/build-status").json()
            assert live["active"] is True
            assert live["document_name"] == "report.txt"
            assert live["stage"] == "extract_relations"
            assert live["processed"] == 1 and live["total"] == 4
            assert live["entities"] == 3
            assert {step["id"]: step["state"] for step in live["steps"]} == {
                "ingest": "done",
                "parse": "done",
                "extract": "running",
                "build": "pending",
                "write": "pending",
            }
            busy = client.post(f"/api/documents/{uploaded['id']}/build-graph", json={"method": "pattern"})
            assert busy.status_code == 409
            assert "report.txt" in busy.json()["detail"]
    finally:
        status.reset()
