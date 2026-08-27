# Agent integrations: bring Decision Cabinet into existing MCP hosts

Decision Cabinet v0.4.0 ships a read-only, stateless MCP server. It uses stdio by default and can also run Streamable HTTP on local loopback. MCP-capable hosts such as Codex, Claude Code, DeepSeek Harness, Hugging Face Tiny Agents, and ML Claw/OpenClaw can reuse the same knowledge cards, decision map, advisor lenses, and four-round deliberation protocol without copying internal prompts.

> The [GitHub Pages demo](https://joyozhang333-lgtm.github.io/decision-cabinet/demo/) is a static browser experience. It is not a remote MCP backend and cannot inspect or start agents installed on your computer.

## MCP tools

The stdio and loopback Streamable HTTP transports expose the same five tools:

| Tool | Purpose |
| --- | --- |
| `decision_cabinet_search_knowledge` | Search traceable decision, business, finance, management, and wisdom cards |
| `decision_cabinet_offline_map` | Build an offline map of choices, costs, opportunity costs, reversibility, and scenarios |
| `decision_cabinet_list_advisors` | List public advisor-method metadata without exposing internal guardrails |
| `decision_cabinet_four_round_protocol` | Return the four round responsibilities, required outputs, and user participation modes |
| `decision_cabinet_prepare_turn` | Prepare an advisor brief that must answer a prior position and contribute something new |

The tools do not store prompts, profiles, or decisions; they do not fetch live market data; and they do not grant arbitrary shell or file-write access. The host model is still selected, authorized, and paid for by the user.

## Install the local server

Python 3.11 or newer is required:

```bash
git clone https://github.com/joyozhang333-lgtm/decision-cabinet.git
cd decision-cabinet
python3 -m venv .venv
source .venv/bin/activate
pip install -e '.[mcp]'
```

The `decision-cabinet-mcp` command starts the default stdio server. To connect an HTTP client on the same host, start the built-in loopback Streamable HTTP transport:

```bash
decision-cabinet-mcp --transport streamable-http --host 127.0.0.1 --port 8765 --path /mcp
```

The endpoint is `http://127.0.0.1:8765/mcp`. The built-in service has no public authentication and rejects non-loopback binds such as `0.0.0.0`, LAN addresses, and public hostnames. A generic stdio host configuration is available at [`plugins/decision-cabinet/examples/mcp-host.example.json`](../plugins/decision-cabinet/examples/mcp-host.example.json). Host configuration filenames and fields differ, so follow the host's current official documentation.

## Codex

The repository includes a Codex plugin manifest, MCP configuration, and a `decision-council` skill. A remote marketplace install adds plugin metadata; it does not install the Python package or MCP SDK. The complete installation is:

```bash
python3 -m pip install 'decision-cabinet[mcp] @ git+https://github.com/joyozhang333-lgtm/decision-cabinet.git@v0.4.0'
codex plugin marketplace add joyozhang333-lgtm/decision-cabinet --ref v0.4.0
codex plugin add decision-cabinet@decision-cabinet
```

For a repository checkout, run `python3 -m pip install -e '.[mcp]'` at the repository root, then add the local marketplace with `codex plugin marketplace add .`.

The plugin adds decision tools. It does not silently expand Codex file-system or shell permissions.

Official documentation: [Codex MCP](https://developers.openai.com/codex/mcp/).

## Claude Code

The repository includes a Claude Code plugin manifest. Install the Python package first, then register the executable directly:

```bash
claude mcp add decision-cabinet -- decision-cabinet-mcp
```

Third-party products may not reuse Claude Free, Pro, or Max subscription OAuth credentials. The Decision Cabinet MCP server does not call Claude on its own. If the web app is separately configured with the Claude provider, use a permitted Anthropic API key or enterprise cloud authentication.

Official documentation: [Claude Code MCP](https://code.claude.com/docs/en/mcp) · [legal and compliance](https://code.claude.com/docs/en/legal-and-compliance).

## DeepSeek Harness

The repository provides `plugins/decision-cabinet/presets/deepseek-harness.cordis.yml` for the DeepSeek Harness MCP Client. Harness keeps responsibility for session composition; Decision Cabinet exposes only the read-only decision tools.

DeepSeek Harness is still a developer preview. The preset does not enable `danger-full-access`, editing, or Bash. Because `dsh` was not installed in the release environment, v0.4.0 does not claim a locally verified end-to-end Harness CLI run. Check the current schema against the official repository before use.

Official documentation: [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) · [MCP Client](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/mcp/mcp-client/README.md).

## Hugging Face Tiny Agents and ML Claw

Tiny Agents follows the official **Agent SDK + MCP** route through `plugins/decision-cabinet/presets/huggingface-agent.json`. Its model is an example; users choose their own model and Inference Provider.

If “Little Lobster” refers to Hugging Face's [ML Claw](https://github.com/huggingface/mlclaw), that project deploys an OpenClaw runtime and is a different integration surface. Current OpenClaw documentation registers a local stdio MCP server with:

```bash
openclaw mcp add decision-cabinet --command decision-cabinet-mcp
openclaw mcp doctor decision-cabinet --probe
```

The matching configuration fragment is `plugins/decision-cabinet/presets/mlclaw-openclaw.mcp.json`. The older OpenClaw binary available in the release environment did not yet include the current `mcp` subcommand, so v0.4.0 follows the current official configuration contract but does not claim a hosted ML Claw end-to-end test. Custom MCP injection in a hosted Space still depends on its runtime version and deployment permissions.

Official documentation: [Tiny Agents](https://huggingface.co/docs/hub/agents-sdk) · [Hugging Face MCP API](https://huggingface.co/docs/huggingface_hub/en/package_reference/mcp) · [ML Claw](https://github.com/huggingface/mlclaw) · [OpenClaw MCP registry](https://github.com/openclaw/openclaw/blob/main/docs/cli/mcp.md).

## Tencent WorkBuddy

WorkBuddy and Tencent CodeBuddy are different products. A WorkBuddy custom Connector can connect to a **Streamable HTTP MCP** service. Decision Cabinet v0.4.0 includes the loopback HTTP transport above, but WorkBuddy needs a reachable remote HTTPS URL. Deploy the service on a host you control, keep it bound to `127.0.0.1`, place your own HTTPS, authentication, rate-limiting, and access-logging reverse proxy in front, then register the public `/mcp` URL in WorkBuddy. When proxying upstream, rewrite `Host` to `127.0.0.1:8765` and do not forward an external `Origin`; otherwise the built-in DNS-rebinding protection rejects the request.

The GitHub Pages demo cannot serve as this endpoint. Enterprise accounts, Connector permissions, reverse-proxy deployment, and credentials remain the user's responsibility. Never place tokens in the repository or frontend. v0.4.0 has not completed an end-to-end connection test in a WorkBuddy enterprise environment.

Official documentation: [custom Connector](https://cloud.tencent.com/document/product/1831/134453) · [WorkBuddy overview](https://cloud.tencent.com/document/product/1831/134525) · [WorkBuddy Skills](https://cloud.tencent.com/document/product/1831/134432).

## Capability and verification status

| Host | Connection | v0.4.0 status | Important limitation |
| --- | --- | --- | --- |
| Codex | Repository plugin + stdio MCP | CLI arguments checked locally; remote install awaits the v0.4.0 tag | Host controls all permissions |
| Claude Code | Plugin or `claude mcp add` | Command checked locally | Consumer subscription OAuth cannot be reused |
| DeepSeek Harness | Cordis MCP Client preset | Preset included; no local `dsh` run | Developer preview; high-risk permissions disabled |
| Hugging Face Tiny Agents | Agent configuration + MCP | Preset included | User owns model cost and data policy |
| Hugging Face ML Claw / OpenClaw | OpenClaw MCP registry | Configuration fragment included; no hosted ML Claw E2E | Requires a runtime with the current MCP registry and deployment permission |
| Tencent WorkBuddy | Custom Connector + Streamable HTTP MCP | Built-in loopback HTTP handshake verified locally; no enterprise-environment end-to-end test | User must provide HTTPS + authenticated reverse proxy; static demo is not a backend |

## Security guidance

- Test with a non-sensitive local question before supplying real business, investment, or personal material.
- Grant least privilege. Decision Cabinet does not need repository editing or Bash access.
- An external model receives whatever decision context the host sends. Review it for personal data, trading records, and business secrets.
- An agent integration does not create live market data. Investment discussions still require a timestamp and primary disclosures.
- MCP output is decision structure and discussion material, not investment, legal, medical, or tax advice. The user retains final authority.

[中文接入指南](INTEGRATIONS.md)
