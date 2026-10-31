"""OpenAI-compatible model endpoint settings for the Explorer."""

import pytest

from semantica.explorer.model_settings import ModelSettingsStore, probe


class _Response:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code
        self.text = str(payload)

    def json(self):
        return self._payload


def test_saved_values_override_env_and_keep_api_key(tmp_path, monkeypatch):
    monkeypatch.setenv("SEMANTICA_EMBEDDING_BASE_URL", "http://env-host:9000/v1")
    monkeypatch.setenv("SEMANTICA_EMBEDDING_MODEL", "env-embed")
    store = ModelSettingsStore(tmp_path / "models.json")

    assert store.resolved("embedding")["model"] == "env-embed"
    assert store.public_view()["embedding"]["source"] == "env"

    store.update("llm", "http://localhost:8000/v1/", "qwen", "secret")
    store.update("llm", "http://localhost:8000/v1", "qwen2", None)
    llm = store.resolved("llm")
    assert llm == {"base_url": "http://localhost:8000/v1", "model": "qwen2", "api_key": "secret"}

    view = store.public_view()["llm"]
    assert view["has_api_key"] is True
    assert "api_key" not in view
    assert view["source"] == "saved"

    store.clear("llm")
    assert store.is_configured("llm") is False


def test_update_rejects_non_http_base_url(tmp_path):
    store = ModelSettingsStore(tmp_path / "models.json")
    with pytest.raises(ValueError):
        store.update("llm", "file:///etc/passwd", "m", None)


def test_probes_call_openai_compatible_paths(monkeypatch):
    calls = []
    replies = {
        "chat/completions": {"choices": [{"message": {"content": "pong"}}]},
        "embeddings": {"data": [{"index": 0, "embedding": [0.1, 0.2, 0.3]}]},
        "rerank": {"results": [{"index": 0, "relevance_score": 0.9}, {"index": 1, "relevance_score": 0.1}]},
    }

    def fake_post(url, json, headers, timeout):
        calls.append((url, headers.get("Authorization")))
        return _Response(next(body for path, body in replies.items() if url.endswith(path)))

    monkeypatch.setattr("semantica.explorer.model_settings.httpx.post", fake_post)
    settings = {"base_url": "http://local:8000/v1", "model": "m", "api_key": "k"}

    assert probe("llm", settings) == {"ok": True, "detail": "reply: pong", "latency_ms": pytest.approx(0, abs=1000)}
    assert probe("embedding", settings)["detail"] == "dimension: 3"
    assert probe("rerank", settings)["detail"] == "top document: #0"
    assert [url for url, _ in calls] == [
        "http://local:8000/v1/chat/completions",
        "http://local:8000/v1/embeddings",
        "http://local:8000/v1/rerank",
    ]
    assert all(auth == "Bearer k" for _, auth in calls)


def test_probe_reports_http_errors(monkeypatch):
    monkeypatch.setattr(
        "semantica.explorer.model_settings.httpx.post",
        lambda url, json, headers, timeout: _Response({"error": "bad model"}, status_code=404),
    )
    result = probe("embedding", {"base_url": "http://local:8000/v1", "model": "m", "api_key": ""})
    assert result["ok"] is False
    assert "HTTP 404" in result["detail"]


def test_settings_routes_mask_key_and_enable_llm_extraction(tmp_path, monkeypatch):
    pytest.importorskip("fastapi")
    from semantica.context.context_graph import ContextGraph
    from semantica.explorer import document_graph
    from semantica.explorer.app import create_app
    from semantica.explorer.session import GraphSession
    from starlette.testclient import TestClient

    monkeypatch.setenv("SEMANTICA_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("SEMANTICA_ALLOW_ANONYMOUS", "true")
    monkeypatch.delenv("SEMANTICA_LLM_BASE_URL", raising=False)
    monkeypatch.delenv("SEMANTICA_LLM_MODEL", raising=False)
    monkeypatch.setattr(document_graph, "_installed", lambda package: package == "openai")
    app = create_app(session=GraphSession(ContextGraph(advanced_analytics=False)))
    with TestClient(app) as client:
        assert client.get("/api/settings/models").json()["llm"]["configured"] is False

        saved = client.put(
            "/api/settings/models/llm",
            json={"base_url": "http://localhost:8000/v1", "model": "qwen", "api_key": "secret"},
        )
        assert saved.status_code == 200
        assert saved.json()["llm"] == {
            "base_url": "http://localhost:8000/v1",
            "model": "qwen",
            "has_api_key": True,
            "configured": True,
            "source": "saved",
        }
        assert "secret" not in client.get("/api/settings/models").text

        options = client.get("/api/documents/build-options").json()
        assert {"id": "llm", "available": True} in options["methods"]
        assert options["default"] == "llm"

        assert client.put("/api/settings/models/unknown", json={}).status_code == 404
        bad = client.put("/api/settings/models/rerank", json={"base_url": "ftp://x", "model": "m"})
        assert bad.status_code == 422
