# Decision Cabinet host plugin

This directory packages the repository's read-only MCP server and decision-council skill for local agent hosts.

## Runtime

- Python 3.11 or newer
- Official MCP Python SDK v2: `python3 -m pip install 'mcp>=2,<3'`
- A Decision Cabinet repository checkout, an installed `decision-cabinet` Python package, or `DECISION_CABINET_REPO=/absolute/path/to/decision-cabinet`

The MCP process writes protocol messages only to stdout. Diagnostic errors go to stderr. Its tools do not persist prompts, profiles, or decisions and do not fetch live market data.

## Codex

The repository marketplace is at `.agents/plugins/marketplace.json`. The Codex manifest and `.mcp.json` use the plugin directory as the process working directory, then launch `cabinet.mcp_server` through `scripts/run_mcp.py`.

Install the published repository marketplace:

```bash
python3 -m pip install 'decision-cabinet[mcp] @ git+https://github.com/joyozhang333-lgtm/decision-cabinet.git@v0.4.0'
codex plugin marketplace add joyozhang333-lgtm/decision-cabinet --ref v0.4.0
codex plugin add decision-cabinet@decision-cabinet
```

For a local clone, run this from the repository root instead of the first command above:

```bash
python3 -m pip install -e '.[mcp]'
codex plugin marketplace add .
codex plugin add decision-cabinet@decision-cabinet
```

## Claude Code

The `.claude-plugin/plugin.json` manifest follows Claude Code's plugin metadata format. For a repository checkout, test it in place:

```bash
claude --plugin-dir ./plugins/decision-cabinet
```

Marketplace installs may copy a plugin into a host cache. In that case, install the Python package separately or set `DECISION_CABINET_REPO` to the cloned repository before starting the host.

## Other MCP hosts

`examples/mcp-host.example.json` is a transport-level template, not a claim that every host accepts the same configuration filename or fields. Replace the absolute repository path and follow that host's official MCP configuration instructions.

The `presets/` directory also includes DeepSeek Harness, Hugging Face Tiny Agents, ML Claw/OpenClaw, and Tencent WorkBuddy integration material. The ML Claw fragment targets the current OpenClaw MCP registry contract; hosted deployment permissions remain host-controlled.
