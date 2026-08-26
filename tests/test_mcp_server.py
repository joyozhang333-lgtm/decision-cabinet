from __future__ import annotations

import sys
from pathlib import Path

import anyio
import httpx
import pytest
from mcp.client.session import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client
from mcp.client.streamable_http import streamable_http_client

from cabinet import mcp_server


def test_search_decision_knowledge_is_local_and_bounded() -> None:
    result = mcp_server.search_decision_knowledge(
        "股票仓位和估值应该怎样判断？",
        domains=["finance", "not-a-domain"],
        limit=3,
    )

    assert result["domains"] == ["finance"]
    assert 1 <= result["count"] <= 3
    assert all(card["domain"] == "finance" for card in result["results"])
    assert all("sources" in card and "boundaries" in card for card in result["results"])


def test_offline_decision_map_has_real_options_and_no_storage() -> None:
    result = mcp_server.build_offline_decision_map("是否进入一个新的区域市场？")
    decision_map = result["decision_map"]

    assert result["mode"] == "offline"
    assert result["stored"] is False
    assert decision_map["core_question"] == "是否进入一个新的区域市场？"
    assert len(decision_map["options"]) >= 3
    assert len(decision_map["evolution_paths"]) >= 3
    assert "实时" in result["notice"]


def test_list_advisors_only_returns_public_metadata() -> None:
    result = mcp_server.list_decision_advisors(category="analyst")

    assert result["count"] >= 1
    assert all(item["category"] == "analyst" for item in result["advisors"])
    assert all("guardrails" not in item and "voice_style" not in item for item in result["advisors"])


def test_four_round_protocol_preserves_debate_and_user_modes() -> None:
    protocol = mcp_server.get_four_round_protocol()

    assert [item["round"] for item in protocol["rounds"]] == [1, 2, 3, 4]
    assert "小结论" in protocol["rounds"][0]["required_outputs"]
    assert "具体议题" in protocol["rounds"][1]["required_outputs"]
    assert protocol["advisor_turn_contract"]["must_respond_to_another_view_after_round_one"] is True
    assert {item["mode"] for item in protocol["user_participation"]} == {
        "answer",
        "add",
        "focus",
        "listen",
    }


def test_prepare_roundtable_turn_requires_reply_and_novelty() -> None:
    brief = mcp_server.prepare_roundtable_turn(
        "现在应该扩张还是保留现金？",
        2,
        "munger",
        prior_positions="德鲁克：先界定顾客；CFO：现金只能支撑六个月。",
        user_contribution="我更在意团队不要失速。",
        participation_mode="add",
    )

    assert brief["round"] == 2
    assert brief["advisor"]["id"] == "munger"
    assert brief["participation_mode"] == "add"
    assert "不得原样复述" in brief["reply_requirement"]
    assert "responds_to" in brief["required_turn_fields"]
    assert brief["stored"] is False


@pytest.mark.parametrize("round_index", [0, 5])
def test_prepare_roundtable_turn_rejects_invalid_round(round_index: int) -> None:
    with pytest.raises(ValueError, match="between 1 and 4"):
        mcp_server.prepare_roundtable_turn("要不要试点？", round_index, "analyst")


@pytest.mark.parametrize(
    "advisor_id",
    ("../knowledge/decision/choice-cost", "../../../README", "/etc/passwd", "laozi/../../README"),
)
def test_prepare_roundtable_turn_rejects_malicious_advisor_paths(advisor_id: str) -> None:
    with pytest.raises(ValueError, match="unknown advisor_id") as exc_info:
        mcp_server.prepare_roundtable_turn("要不要试点？", 1, advisor_id)

    message = str(exc_info.value)
    assert "cabinet/resources" not in message
    assert str(Path(__file__).resolve().parents[1]) not in message


def test_sdk_import_fallback_handles_missing_or_v1_sdk() -> None:
    def missing_v2(name: str, *args, **kwargs):
        if name == "mcp.server":
            raise ImportError("simulated SDK v1")
        return __import__(name, *args, **kwargs)

    server_class, error = mcp_server._load_mcp_server_class(missing_v2)

    assert server_class is None
    assert "simulated SDK v1" in error


def test_main_reports_sdk_error_only_on_stderr(monkeypatch, capsys) -> None:
    monkeypatch.setattr(mcp_server, "mcp", None)
    monkeypatch.setattr(mcp_server, "_MCP_SDK_ERROR", "simulated missing SDK")

    with pytest.raises(SystemExit) as exc_info:
        mcp_server.main()

    captured = capsys.readouterr()
    assert exc_info.value.code == 2
    assert captured.out == ""
    assert "mcp>=2,<3" in captured.err
    assert "simulated missing SDK" in captured.err


@pytest.mark.parametrize("host", ["127.0.0.1", "127.42.0.9", "::1", "localhost", "LOCALHOST"])
def test_loopback_hosts_are_accepted(host: str) -> None:
    assert mcp_server._is_loopback_host(host) is True


@pytest.mark.parametrize("host", ["0.0.0.0", "::", "192.168.1.20", "mcp.example.com", ""])
def test_non_loopback_hosts_are_rejected(host: str) -> None:
    assert mcp_server._is_loopback_host(host) is False


@pytest.mark.parametrize(
    ("host", "rendered"),
    [("127.42.0.9", "127.42.0.9"), ("localhost", "localhost"), ("::1", "[::1]")],
)
def test_every_loopback_variant_keeps_dns_rebinding_protection(
    host: str,
    rendered: str,
) -> None:
    security = mcp_server._loopback_transport_security(host)

    assert security.enable_dns_rebinding_protection is True
    assert security.allowed_hosts == [rendered, f"{rendered}:*"]
    assert security.allowed_origins == [f"http://{rendered}", f"http://{rendered}:*"]


def test_http_transport_refuses_non_loopback_bind(monkeypatch, capsys) -> None:
    class FakeServer:
        calls: list[tuple[tuple[object, ...], dict[str, object]]] = []

        def run(self, *args, **kwargs) -> None:
            self.calls.append((args, kwargs))

    fake_server = FakeServer()
    monkeypatch.setattr(mcp_server, "mcp", fake_server)

    with pytest.raises(SystemExit) as exc_info:
        mcp_server.main(["--transport", "streamable-http", "--host", "0.0.0.0"])

    captured = capsys.readouterr()
    assert exc_info.value.code == 2
    assert fake_server.calls == []
    assert captured.out == ""
    assert "Refusing a non-loopback MCP bind" in captured.err
    assert "authenticated HTTPS reverse proxy" in captured.err


def test_http_transport_dispatches_only_loopback_with_stateless_settings(monkeypatch) -> None:
    class FakeServer:
        calls: list[tuple[tuple[object, ...], dict[str, object]]] = []

        def run(self, *args, **kwargs) -> None:
            self.calls.append((args, kwargs))

    fake_server = FakeServer()
    monkeypatch.setattr(mcp_server, "mcp", fake_server)

    mcp_server.main(
        [
            "--transport",
            "streamable-http",
            "--host",
            "127.0.0.1",
            "--port",
            "18765",
            "--path",
            "/decision-cabinet",
        ]
    )

    assert len(fake_server.calls) == 1
    positional, keyword = fake_server.calls[0]
    assert positional == ("streamable-http",)
    security = keyword.pop("transport_security")
    assert keyword == {
        "host": "127.0.0.1",
        "port": 18765,
        "streamable_http_path": "/decision-cabinet",
        "stateless_http": True,
    }
    assert security.enable_dns_rebinding_protection is True
    assert security.allowed_hosts == ["127.0.0.1", "127.0.0.1:*"]
    assert security.allowed_origins == ["http://127.0.0.1", "http://127.0.0.1:*"]


@pytest.mark.parametrize(
    ("args", "message"),
    [
        (["--port", "0"], "between 1 and 65535"),
        (["--port", "65536"], "between 1 and 65535"),
        (["--path", "mcp"], "path must begin with '/'"),
    ],
)
def test_http_transport_rejects_invalid_endpoint_settings(
    monkeypatch,
    capsys,
    args: list[str],
    message: str,
) -> None:
    class FakeServer:
        def run(self, *args, **kwargs) -> None:
            raise AssertionError("invalid HTTP settings must not start the MCP server")

    monkeypatch.setattr(mcp_server, "mcp", FakeServer())

    with pytest.raises(SystemExit) as exc_info:
        mcp_server.main(["--transport", "streamable-http", *args])

    captured = capsys.readouterr()
    assert exc_info.value.code == 2
    assert message in captured.err


def test_streamable_http_protocol_lists_and_calls_public_tools() -> None:
    async def exercise() -> None:
        assert mcp_server.mcp is not None
        app = mcp_server.mcp.streamable_http_app(
            streamable_http_path="/mcp",
            stateless_http=True,
            host="127.0.0.1",
            transport_security=mcp_server._loopback_transport_security("127.0.0.1"),
        )
        async with app.router.lifespan_context(app):
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(
                transport=transport,
                base_url="http://127.0.0.1:8765",
            ) as client:
                protocol_headers = {
                    "content-type": "application/json",
                    "accept": "application/json, text/event-stream",
                }
                bad_host = await client.post(
                    "/mcp",
                    headers={**protocol_headers, "host": "attacker.example"},
                    content=b"{}",
                )
                assert bad_host.status_code == 421
                bad_origin = await client.post(
                    "/mcp",
                    headers={**protocol_headers, "origin": "https://attacker.example"},
                    content=b"{}",
                )
                assert bad_origin.status_code == 403
                async with streamable_http_client(
                    "http://127.0.0.1:8765/mcp",
                    http_client=client,
                ) as streams:
                    async with ClientSession(*streams) as session:
                        initialized = await session.initialize()
                        listed = await session.list_tools()
                        assert initialized.server_info.name == "Decision Cabinet"
                        assert initialized.server_info.version == "0.4.0"
                        assert len(listed.tools) == 5
                        result = await session.call_tool(
                            "decision_cabinet_four_round_protocol",
                            {},
                        )
                        assert result.is_error is False
                        assert result.content

    anyio.run(exercise)


def test_stdio_server_registers_and_calls_all_public_tools() -> None:
    async def exercise() -> None:
        params = StdioServerParameters(
            command=sys.executable,
            args=["-m", "cabinet.mcp_server"],
            cwd=Path(__file__).resolve().parents[1],
        )
        async with stdio_client(params) as streams:
            async with ClientSession(*streams) as session:
                initialized = await session.initialize()
                listed = await session.list_tools()
                names = {tool.name for tool in listed.tools}
                assert initialized.server_info.name == "Decision Cabinet"
                assert initialized.server_info.version == "0.4.0"
                assert names == {
                    "decision_cabinet_search_knowledge",
                    "decision_cabinet_offline_map",
                    "decision_cabinet_list_advisors",
                    "decision_cabinet_four_round_protocol",
                    "decision_cabinet_prepare_turn",
                }
                result = await session.call_tool("decision_cabinet_four_round_protocol", {})
                assert result.is_error is False
                assert result.content

    anyio.run(exercise)
