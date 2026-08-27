from __future__ import annotations

import json
from pathlib import Path

from cabinet.version import VERSION


ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / "plugins" / "decision-cabinet"


def _load_json(path: Path) -> dict[str, object]:
    return json.loads(path.read_text(encoding="utf-8"))


def test_codex_marketplace_and_plugin_manifest_are_release_ready() -> None:
    marketplace = _load_json(ROOT / ".agents" / "plugins" / "marketplace.json")
    manifest = _load_json(PLUGIN / ".codex-plugin" / "plugin.json")

    assert marketplace["name"] == "decision-cabinet"
    assert marketplace["plugins"][0]["source"] == {
        "source": "local",
        "path": "./plugins/decision-cabinet",
    }
    assert manifest["name"] == "decision-cabinet"
    assert manifest["version"] == VERSION
    assert manifest["mcpServers"] == "./.mcp.json"
    assert manifest["skills"] == "./skills/"


def test_claude_manifest_and_mcp_config_point_to_bundled_runner() -> None:
    manifest = _load_json(PLUGIN / ".claude-plugin" / "plugin.json")
    mcp_config = _load_json(PLUGIN / ".mcp.json")

    assert manifest["version"] == VERSION
    assert manifest["mcpServers"] == "./.mcp.json"
    server = mcp_config["mcpServers"]["decision-cabinet"]
    assert server == {
        "command": "python3",
        "args": ["./scripts/run_mcp.py"],
        "cwd": ".",
    }
    assert (PLUGIN / "scripts" / "run_mcp.py").is_file()


def test_hugging_face_and_openclaw_presets_use_installed_console_script() -> None:
    tiny_agents = _load_json(PLUGIN / "presets" / "huggingface-agent.json")
    openclaw = _load_json(PLUGIN / "presets" / "mlclaw-openclaw.mcp.json")

    assert tiny_agents["servers"][0] == {
        "type": "stdio",
        "command": "decision-cabinet-mcp",
        "args": [],
    }
    server = openclaw["mcp"]["servers"]["decision-cabinet"]
    assert server["command"] == "decision-cabinet-mcp"
    assert server["enabled"] is True
    assert server["toolFilter"]["include"] == ["decision_cabinet_*"]


def test_deepseek_and_workbuddy_presets_keep_explicit_safety_boundaries() -> None:
    deepseek = (PLUGIN / "presets" / "deepseek-harness.cordis.yml").read_text(
        encoding="utf-8"
    )
    workbuddy = (PLUGIN / "presets" / "workbuddy" / "README.zh-CN.md").read_text(
        encoding="utf-8"
    )

    assert 'name: "@deepseek-ai/dsh-mcp-client"' in deepseek
    assert "command: decision-cabinet-mcp" in deepseek
    assert "danger-full-access" in deepseek
    assert "127.0.0.1" in workbuddy
    assert "--transport streamable-http" in workbuddy
    assert "HTTPS" in workbuddy
    assert "鉴权" in workbuddy
