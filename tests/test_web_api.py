from __future__ import annotations

import json
import queue
import threading
import pytest
from fastapi.testclient import TestClient
from starlette.responses import Response

from cabinet import web_api
from cabinet.store import CabinetStore
from conftest import FakeProvider


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(web_api, "get_provider", lambda name=None: FakeProvider())
    store = CabinetStore(":memory:")
    return TestClient(web_api.create_app(store))


def test_health_and_config(client: TestClient) -> None:
    assert client.get("/api/health").json()["status"] == "ok"
    config = client.get("/api/product/config").json()
    assert config["advisor_count"] >= 10
    assert config["knowledge_count"] >= 20
    assert config["knowledge_domains"]["finance"] >= 4
    assert "providers" in config


def test_knowledge_catalog_search_and_decision_map(client: TestClient) -> None:
    catalog = client.get("/api/knowledge", params={"domain": "finance"}).json()
    assert len(catalog["cards"]) >= 4
    assert all(card["domain"] == "finance" for card in catalog["cards"])

    searched = client.get("/api/knowledge", params={"q": "股票 仓位"}).json()
    assert any(card["id"] == "portfolio-risk" for card in searched["cards"])

    mapped = client.post("/api/decision/map", json={"question": "是否买入这只股票？"}).json()
    assert mapped["decision_type"] == "investment"
    assert mapped["evidence_to_collect"]
    assert mapped["evolution_paths"]


def test_list_and_get_advisors(client: TestClient) -> None:
    advisors = client.get("/api/advisors").json()["advisors"]
    assert len(advisors) >= 10
    huineng = client.get("/api/advisors/huineng").json()
    assert huineng["name"] == "六祖惠能"
    assert client.get("/api/advisors/nobody").status_code == 404


def test_factsheet_and_deliberate_and_persist(client: TestClient) -> None:
    sheet = client.post("/api/council/factsheet", json={"question": "该不该进入新市场？"}).json()
    assert sheet["facts"]

    result = client.post(
        "/api/council/deliberate",
        json={"question": "该不该进入新市场？", "depth": "standard"},
    ).json()
    assert len(result["turns"]) >= 10
    assert result["synthesis"]["decision_and_next"]
    assert result["decision_id"]

    # 圆桌记录可取回
    got = client.get(f"/api/council/sessions/{result['id']}")
    assert got.status_code == 200
    # 自动起草的决策落库
    decision = client.get(f"/api/decisions/{result['decision_id']}").json()
    assert decision["status"] == "draft"


def test_clarify_endpoint(client: TestClient) -> None:
    r = client.post("/api/council/clarify", json={"question": "定价 1980 还是 4980？"}).json()
    assert "questions" in r
    assert len(r["questions"]) >= 1


def test_deliberate_with_clarifications(client: TestClient) -> None:
    r = client.post(
        "/api/council/deliberate",
        json={
            "question": "该不该进入新市场？",
            "depth": "brief",
            "advisor_ids": ["analyst", "laozi"],
            "clarifications": [{"q": "交付一次要多少小时", "a": "约20小时"}],
        },
    ).json()
    assert len(r["turns"]) == 2
    assert r["decision_id"]


def test_round_and_close_endpoints(client: TestClient) -> None:
    r = client.post(
        "/api/council/round",
        json={"question": "定价？", "advisor_ids": ["analyst", "laozi"], "round_index": 1, "transcript": [], "depth": "brief"},
    )
    assert r.status_code == 200
    assert "event: turn" in r.text and "event: done" in r.text

    c = client.post(
        "/api/council/close",
        json={
            "question": "定价？",
            "depth": "brief",
            "transcript": [{"round": 1, "role": "advisor", "speaker_id": "analyst", "speaker_name": "首席分析师", "content": "先看数据"}],
        },
    )
    assert c.status_code == 200
    assert "event: done" in c.text


def test_close_persists_full_decision_map_snapshot(client: TestClient) -> None:
    mapped = client.post("/api/decision/map", json={"question": "是否进入新市场？"}).json()
    closed = client.post(
        "/api/council/close",
        json={"question": "是否进入新市场？", "transcript": [], "decision_map": mapped},
    )
    done = next(
        json.loads(line.removeprefix("data: "))
        for line in closed.text.splitlines()
        if line.startswith("data: ") and "decision_id" in line
    )
    decision = client.get(f"/api/decisions/{done['decision_id']}").json()
    assert decision["decision_map"]["evolution_paths"]
    assert decision["options_considered"] == [option["name"] for option in mapped["options"]]
    assert "停止/退出条件" in decision["expectation"]


def test_cancelled_close_does_not_persist_unconfirmed_draft(monkeypatch) -> None:
    provider = FakeProvider()
    store = CabinetStore(":memory:")
    captured: dict[str, object] = {}

    monkeypatch.setattr(web_api, "get_provider", lambda name=None: provider)

    def capture_producer(produce, *, release_slot=None):
        captured["produce"] = produce
        if release_slot is not None:
            release_slot.release()
        return Response(status_code=204)

    monkeypatch.setattr(web_api, "_sse_response", capture_producer)
    client = TestClient(web_api.create_app(store))
    response = client.post(
        "/api/council/close",
        json={"question": "是否进入新市场？", "transcript": []},
    )
    assert response.status_code == 204

    cancelled = threading.Event()
    cancelled.set()
    captured["produce"](queue.Queue(), cancelled)
    assert store.list_decisions() == []


def test_chat_endpoint(client: TestClient) -> None:
    r = client.post("/api/advisors/laozi/chat", json={"question": "我该不该扩张？"}).json()
    assert r["answer"]
    assert r["session_id"]
    # 二轮带 session_id 继续
    r2 = client.post(
        "/api/advisors/laozi/chat",
        json={"question": "再多说一点", "session_id": r["session_id"]},
    ).json()
    assert len(r2["session"]["messages"]) == 4


def test_decisions_crud_and_review(client: TestClient) -> None:
    created = client.post(
        "/api/decisions",
        json={"title": "测试决策", "chosen": "方案A", "tags": ["市场"], "status": "decided"},
    ).json()
    did = created["id"]
    assert client.get("/api/decisions", params={"tag": "市场"}).json()["decisions"]
    patched = client.patch(f"/api/decisions/{did}", json={"chosen": "方案B"}).json()
    assert patched["chosen"] == "方案B"
    reviewed = client.post(f"/api/decisions/{did}/review", json={"review_outcome": "效果不错"}).json()
    assert reviewed["status"] == "reviewed"


def test_org_memory_get_put(client: TestClient) -> None:
    assert client.get("/api/org-memory").json()["mission"]
    put = client.put(
        "/api/org-memory",
        json={"mission": "新的使命", "values": ["如实照见"], "audience": [], "product_lines": [], "constraints": [], "voice_and_taste": "沉静"},
    ).json()
    assert put["mission"] == "新的使命"
    assert client.get("/api/org-memory").json()["mission"] == "新的使命"


def test_external_model_memory_is_opt_in(monkeypatch) -> None:
    provider = FakeProvider()
    monkeypatch.setattr(web_api, "get_provider", lambda name=None: provider)
    client = TestClient(web_api.create_app(CabinetStore(":memory:")))
    client.put(
        "/api/org-memory",
        json={
            "mission": "PRIVATE-MISSION-MARKER",
            "values": [], "audience": [], "product_lines": [], "constraints": [], "voice_and_taste": "",
        },
    )
    client.post(
        "/api/decisions",
        json={"title": "PRIVATE-DECISION-MARKER", "chosen": "A", "status": "decided"},
    )

    client.post("/api/council/clarify", json={"question": "是否扩张？"})
    without_memory = json.dumps(provider.calls[-1], ensure_ascii=False)
    assert "PRIVATE-MISSION-MARKER" not in without_memory
    assert "PRIVATE-DECISION-MARKER" not in without_memory

    client.post(
        "/api/council/clarify",
        json={"question": "是否扩张？", "include_memory": True},
    )
    with_memory = json.dumps(provider.calls[-1], ensure_ascii=False)
    assert "PRIVATE-MISSION-MARKER" in with_memory
    assert "PRIVATE-DECISION-MARKER" in with_memory


def test_external_api_requires_key(client: TestClient, monkeypatch) -> None:
    # 未设置 CABINET_API_KEY → 关闭
    monkeypatch.delenv("CABINET_API_KEY", raising=False)
    monkeypatch.delenv("CABINET_EXTERNAL_API_KEY", raising=False)
    r = client.post("/api/v1/council/deliberate", json={"question": "x"})
    assert r.status_code == 403

    # 设置后需正确 key
    monkeypatch.setenv("CABINET_API_KEY", "secret")
    assert client.post("/api/v1/council/deliberate", json={"question": "x"}, headers={"X-API-Key": "wrong"}).status_code == 401
    ok = client.post("/api/v1/council/deliberate", json={"question": "x"}, headers={"X-API-Key": "secret"})
    assert ok.status_code == 200
    assert ok.json()["decision_id"]


def test_private_ui_api_blocks_cross_site_and_untrusted_remote_clients(monkeypatch) -> None:
    monkeypatch.setattr(web_api, "get_provider", lambda name=None: FakeProvider())
    monkeypatch.delenv("CABINET_UI_API_KEY", raising=False)
    app = web_api.create_app(CabinetStore(":memory:"))
    local = TestClient(app)
    assert local.get("/api/org-memory", headers={"Sec-Fetch-Site": "cross-site"}).status_code == 403

    remote = TestClient(app, client=("203.0.113.10", 50000))
    assert remote.get("/api/org-memory").status_code == 403
    monkeypatch.setenv("CABINET_UI_API_KEY", "remote-secret")
    assert remote.get("/api/org-memory").status_code == 401
    assert remote.get("/api/org-memory", headers={"X-API-Key": "remote-secret"}).status_code == 200
    # 反向代理常把远程请求转成 loopback；配置 key 后，本机来源也不能绕过。
    assert local.get("/api/org-memory").status_code == 401
    assert local.get("/api/org-memory", headers={"X-API-Key": "remote-secret"}).status_code == 200


def test_external_key_does_not_break_local_ui(monkeypatch) -> None:
    monkeypatch.setattr(web_api, "get_provider", lambda name=None: FakeProvider())
    monkeypatch.setenv("CABINET_EXTERNAL_API_KEY", "external-only")
    monkeypatch.delenv("CABINET_UI_API_KEY", raising=False)
    local = TestClient(web_api.create_app(CabinetStore(":memory:")))
    assert local.get("/api/org-memory").status_code == 200


def test_untrusted_forwarded_header_cannot_spoof_loopback(monkeypatch) -> None:
    monkeypatch.setattr(web_api, "get_provider", lambda name=None: FakeProvider())
    monkeypatch.delenv("CABINET_UI_API_KEY", raising=False)
    app = web_api.create_app(CabinetStore(":memory:"))
    local = TestClient(app)
    remote = TestClient(app, client=("203.0.113.10", 50000))
    assert local.get("/api/org-memory", headers={"X-Forwarded-For": "203.0.113.20"}).status_code == 403
    assert remote.get("/api/org-memory", headers={"X-Forwarded-For": "127.0.0.1"}).status_code == 403


def test_side_effecting_get_stream_endpoint_is_removed(client: TestClient) -> None:
    response = client.get("/api/council/deliberate/stream", params={"question": "x"})
    assert response.status_code in {404, 405}


def test_council_request_cost_budgets_are_enforced(client: TestClient) -> None:
    too_many_advisors = client.post(
        "/api/council/round",
        json={"question": "x", "advisor_ids": [f"advisor-{i}" for i in range(17)], "transcript": []},
    )
    assert too_many_advisors.status_code == 422

    oversized_transcript = [
        {"role": "advisor", "speaker_name": "a", "content": "x" * 4000}
        for _ in range(21)
    ]
    oversized = client.post(
        "/api/council/round",
        json={"question": "x", "advisor_ids": ["analyst"], "transcript": oversized_transcript},
    )
    assert oversized.status_code == 422
