"""Graph library: several named graphs on disk, one loaded into the Explorer."""

import pytest

pytest.importorskip("fastapi")

from starlette.testclient import TestClient  # noqa: E402

from semantica.context.context_graph import ContextGraph  # noqa: E402
from semantica.explorer.app import create_app  # noqa: E402
from semantica.explorer.build_status import get_build_status  # noqa: E402
from semantica.explorer.graph_library import GraphLibrary  # noqa: E402
from semantica.explorer.session import GraphSession  # noqa: E402


def _node_ids(client: TestClient) -> set[str]:
    return {node["id"] for node in client.get("/api/graph/nodes").json()["nodes"]}


def _add_node(client: TestClient, node_id: str, content: str) -> None:
    client.app.state.session.graph.add_node(node_id, "entity", content)


def test_default_app_creates_a_default_graph_and_lists_it():
    with TestClient(create_app()) as client:
        listing = client.get("/api/graphs").json()
    assert len(listing["graphs"]) == 1
    only = listing["graphs"][0]
    assert listing["active_id"] == only["id"]
    assert only["active"] is True


def test_switching_graphs_swaps_contents_and_survives_restart():
    with TestClient(create_app()) as client:
        first_id = client.get("/api/graphs").json()["active_id"]
        _add_node(client, "alpha", "Alpha")

        created = client.post("/api/graphs", json={"name": "Second"})
        assert created.status_code == 200
        second = created.json()
        assert second["active"] is True
        assert "alpha" not in _node_ids(client)

        _add_node(client, "beta", "Beta")
        assert client.post(f"/api/graphs/{first_id}/activate").status_code == 200
        assert "alpha" in _node_ids(client)
        assert "beta" not in _node_ids(client)

        listing = {graph["name"]: graph for graph in client.get("/api/graphs").json()["graphs"]}
        assert listing["Second"]["node_count"] == 1

    with TestClient(create_app()) as client:
        assert client.get("/api/graphs").json()["active_id"] == first_id
        assert "alpha" in _node_ids(client)
        client.post(f"/api/graphs/{second['id']}/activate")
        assert _node_ids(client) == {"beta"}


def test_search_follows_the_active_graph():
    with TestClient(create_app()) as client:
        _add_node(client, "lovelace", "Ada Lovelace")
        before = client.post("/api/graph/search", json={"query": "Lovelace"}).json()
        assert before["results"]
        client.post("/api/graphs", json={"name": "Empty"})
        after = client.post("/api/graph/search", json={"query": "Lovelace"}).json()
    assert after["results"] == []


def test_rename_delete_and_name_rules():
    with TestClient(create_app()) as client:
        active_id = client.get("/api/graphs").json()["active_id"]
        other = client.post("/api/graphs", json={"name": "Scratch", "activate": False}).json()
        assert other["active"] is False

        assert client.post("/api/graphs", json={"name": "Scratch"}).status_code == 409
        assert client.post("/api/graphs", json={"name": "   "}).status_code == 422

        renamed = client.put(f"/api/graphs/{other['id']}", json={"name": "Notes"})
        assert renamed.json()["name"] == "Notes"

        assert client.delete(f"/api/graphs/{active_id}").status_code == 409
        assert client.delete(f"/api/graphs/{other['id']}").status_code == 200
        assert [graph["id"] for graph in client.get("/api/graphs").json()["graphs"]] == [active_id]
        assert client.post("/api/graphs/not-a-graph/activate").status_code == 404


def test_switching_is_refused_while_a_document_builds():
    status = get_build_status()
    status.reset()
    try:
        with TestClient(create_app()) as client:
            other = client.post("/api/graphs", json={"name": "Later", "activate": False}).json()
            assert status.try_begin("doc", "report.txt", "pattern")
            refused = client.post(f"/api/graphs/{other['id']}/activate")
            assert refused.status_code == 409
            assert "report.txt" in refused.json()["detail"]
    finally:
        status.reset()


def test_supplied_session_is_stored_under_its_source_name(tmp_path):
    source = tmp_path / "people.json"
    graph = ContextGraph(advanced_analytics=False)
    graph.add_node("ada", "person", "Ada Lovelace")
    graph.save_to_file(str(source))

    with TestClient(create_app(session=GraphSession.from_file(str(source)))) as client:
        names = [entry["name"] for entry in client.get("/api/graphs").json()["graphs"]]
        assert names == ["people"]
        assert "ada" in _node_ids(client)

    with TestClient(create_app(session=GraphSession.from_file(str(source)))) as client:
        assert [entry["name"] for entry in client.get("/api/graphs").json()["graphs"]] == ["people"]


def test_saved_graph_is_loaded_by_the_next_library(tmp_path):
    session = GraphSession(ContextGraph(advanced_analytics=False))
    library = GraphLibrary(tmp_path / "graphs", session)
    library.attach(adopt_session=False)
    session.graph.add_node("kept", "entity", "Kept")
    library.save_active()

    reopened = GraphSession(ContextGraph(advanced_analytics=False))
    GraphLibrary(tmp_path / "graphs", reopened).attach(adopt_session=False)
    assert "kept" in reopened.graph.nodes
