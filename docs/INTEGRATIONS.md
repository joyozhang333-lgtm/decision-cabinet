# 智能体接入：用 MCP 把决策内阁带进现有工作台

Decision Cabinet v0.4.0 提供一个默认只读、无状态的 MCP server，默认使用 stdio，也可以在本机 loopback 上运行 Streamable HTTP。Codex、Claude Code、DeepSeek Harness、Hugging Face Tiny Agents、ML Claw/OpenClaw 等支持 MCP 的宿主，可以复用同一套知识卡、决策地图、顾问视角和四轮议事协议，而不必复制内部提示词。

> 在线 [GitHub Pages Demo](https://joyozhang333-lgtm.github.io/decision-cabinet/demo/) 只是浏览器静态演示，不是远程 MCP 后端，也不会探测或启动你电脑上的智能体。

## MCP server 提供什么

当前 server 通过 stdio 或 loopback Streamable HTTP 暴露同样的五个工具：

| 工具 | 用途 |
| --- | --- |
| `decision_cabinet_search_knowledge` | 搜索仓库内可追溯的决策、商业、金融、管理与智慧知识卡 |
| `decision_cabinet_offline_map` | 生成选择、代价、机会成本、可逆性与演化路径的离线地图 |
| `decision_cabinet_list_advisors` | 列出可公开审查的顾问方法视角，不暴露内部约束 |
| `decision_cabinet_four_round_protocol` | 返回固定四轮职责、输出要求与四种用户参与方式 |
| `decision_cabinet_prepare_turn` | 为某位顾问准备一条必须回应既有观点、必须增加新信息的发言 brief |

这些工具不保存提示、档案或决定，不抓取实时行情，也不给宿主任意 Shell 或文件写权限。宿主模型仍需由用户自行选择、授权和付费。

## 先安装本地 server

要求 Python 3.11+：

```bash
git clone https://github.com/joyozhang333-lgtm/decision-cabinet.git
cd decision-cabinet
python3 -m venv .venv
source .venv/bin/activate
pip install -e '.[mcp]'
```

安装后可用 `decision-cabinet-mcp` 启动默认 stdio server。如需在同一台主机上接入 HTTP 客户端，启动内置 loopback Streamable HTTP：

```bash
decision-cabinet-mcp --transport streamable-http --host 127.0.0.1 --port 8765 --path /mcp
```

服务地址是 `http://127.0.0.1:8765/mcp`。内置服务无公网鉴权，会拒绝 `0.0.0.0`、局域网 IP 或公网主机名等非 loopback 绑定。通用 stdio 宿主配置模板见 [`plugins/decision-cabinet/examples/mcp-host.example.json`](../plugins/decision-cabinet/examples/mcp-host.example.json)。不同宿主的配置文件名和字段可能不同，请以各自官方文档为准。

## Codex

仓库内置 Codex plugin manifest、MCP 配置和 `decision-council` skill。远程添加 marketplace 只安装 plugin 元数据，不会安装 Python 包或 MCP SDK。完整安装是：

```bash
python3 -m pip install 'decision-cabinet[mcp] @ git+https://github.com/joyozhang333-lgtm/decision-cabinet.git@v0.4.0'
codex plugin marketplace add joyozhang333-lgtm/decision-cabinet --ref v0.4.0
codex plugin add decision-cabinet@decision-cabinet
```

如果已经 clone 仓库，可以在仓库根目录运行 `python3 -m pip install -e '.[mcp]'`，再用 `codex plugin marketplace add .` 添加本地 marketplace。

安装后，可直接要求 Codex 使用 Decision Cabinet 搜索知识、生成决策地图或主持四轮私董会。插件只提供决策工具，不自动扩大 Codex 的文件或 Shell 权限。

官方说明：[Codex MCP](https://developers.openai.com/codex/mcp/)。

## Claude Code

仓库内置 Claude Code plugin manifest；也可以先按上文安装 Python package，再把可执行命令注册为本地 MCP server：

```bash
claude mcp add decision-cabinet -- decision-cabinet-mcp
```

如从仓库目录加载 plugin，可按 Claude Code 的 plugin 机制使用 `plugins/decision-cabinet/`。第三方产品不得复用 Claude Free、Pro 或 Max 订阅的 OAuth 凭证。Decision Cabinet 的 MCP server 本身不反向调用 Claude；若你另外在 Web 应用中使用 Claude provider，应使用合法的 Anthropic API key 或企业云认证。

官方说明：[Claude Code MCP](https://code.claude.com/docs/en/mcp) · [认证与合规边界](https://code.claude.com/docs/en/legal-and-compliance)。

## DeepSeek Harness

仓库提供面向 DeepSeek Harness MCP Client 的 Cordis 预设：`plugins/decision-cabinet/presets/deepseek-harness.cordis.yml`。把预设合并到自己的 composition 后，由 Harness 负责会话编排，Decision Cabinet 只提供只读决策工具。

DeepSeek Harness 当前仍是 developer preview。预设不启用 `danger-full-access`，也不向 Decision Cabinet 开放编辑或 Bash。由于本机没有安装 `dsh`，本版本未完成 DeepSeek Harness CLI 的端到端运行验证；使用前请对照官方仓库和 MCP Client 文档检查当前字段。

官方说明：[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) · [MCP Client](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/mcp/mcp-client/README.md)。

## Hugging Face Tiny Agents 与 ML Claw

Tiny Agents 按官方 **Agent SDK + MCP** 路径使用 `plugins/decision-cabinet/presets/huggingface-agent.json`；预设中的模型只是示例，模型和 Inference Provider 由使用者自行选择。

如果你说的“小龙虾”是 Hugging Face 的 [ML Claw](https://github.com/huggingface/mlclaw)，它部署的是 OpenClaw runtime，与 Tiny Agents 不是同一个接入面。当前 OpenClaw 官方 MCP registry 可直接登记本地 stdio server：

```bash
openclaw mcp add decision-cabinet --command decision-cabinet-mcp
openclaw mcp doctor decision-cabinet --probe
```

对应配置片段在 `plugins/decision-cabinet/presets/mlclaw-openclaw.mcp.json`。本机已有的旧版 OpenClaw CLI 尚未包含当前 `mcp` 子命令，因此本版按官方当前配置契约提供预设，但不声称完成 ML Claw 托管环境端到端验证；Hosted Space 是否允许注入自定义 MCP 仍取决于该部署的 runtime 与权限。

官方说明：[Tiny Agents](https://huggingface.co/docs/hub/agents-sdk) · [Hugging Face MCP API](https://huggingface.co/docs/huggingface_hub/en/package_reference/mcp) · [ML Claw](https://github.com/huggingface/mlclaw) · [OpenClaw MCP registry](https://github.com/openclaw/openclaw/blob/main/docs/cli/mcp.md)。

## 腾讯 WorkBuddy

WorkBuddy 与腾讯 CodeBuddy 是不同产品。WorkBuddy 的自定义 Connector 可连接 **Streamable HTTP MCP** 服务。本仓库 v0.4.0 已提供上述 loopback HTTP 通道，但 WorkBuddy 需要能访问的远程 HTTPS URL：请把服务部署在你控制的主机上，仍只监听 `127.0.0.1`，再在前面配置 HTTPS、鉴权、速率限制和访问日志反向代理，最后把公网 `/mcp` URL 填入 WorkBuddy。反代转发给上游时，请把 `Host` 重写为 `127.0.0.1:8765`，并不要转发外部 `Origin`，否则内置 DNS rebinding 防护会拒绝请求。

GitHub Pages Demo 不能作为这个地址。企业账号、Connector 权限、反向代理部署和凭证都由使用者管理；不要把 token 写进仓库或前端页面。本版未在 WorkBuddy 企业环境完成端到端连接验证。

官方说明：[自定义 Connector](https://cloud.tencent.com/document/product/1831/134453) · [WorkBuddy 概览](https://cloud.tencent.com/document/product/1831/134525) · [WorkBuddy Skills](https://cloud.tencent.com/document/product/1831/134432)。

## 能力与验证状态

| 宿主 | 接入方式 | v0.4.0 状态 | 重要限制 |
| --- | --- | --- | --- |
| Codex | 仓库 plugin + stdio MCP | CLI 参数已本机核对；远程安装待 v0.4.0 tag | 权限仍由 Codex 宿主控制 |
| Claude Code | plugin 或 `claude mcp add` | 命令已本机核对 | 不得复用消费者订阅 OAuth |
| DeepSeek Harness | Cordis MCP Client 预设 | 提供预设，未做本机 `dsh` 运行验证 | developer preview；禁用高危权限 |
| Hugging Face Tiny Agents | Agent 配置 + MCP | 提供预设 | 模型费用与数据政策由用户承担 |
| Hugging Face ML Claw / OpenClaw | OpenClaw MCP registry | 提供配置片段；未做 ML Claw 托管环境 E2E | 需要包含当前 `mcp` registry 的 runtime 与部署权限 |
| 腾讯 WorkBuddy | 自定义 Connector + Streamable HTTP MCP | 内置 loopback HTTP 已本机握手验证；未做企业环境端到端实测 | 需自建 HTTPS + 鉴权反代；静态 Demo 不是 MCP 后端 |

## 安全建议

- 先在本机用离线问题验证工具，再接入真实商业、投资或人生资料。
- 只给 Decision Cabinet 完成任务所需的最小权限；它不需要编辑仓库或执行 Bash。
- 外部模型会收到宿主发送的决策上下文，请先检查其中是否含个人资料、交易记录或商业机密。
- 股票与金融讨论仍需核验数据时点和原始披露；接入智能体不会自动获得实时行情。
- MCP 输出是结构与讨论材料，不是投资、法律、医疗或税务建议，最终决定权始终属于用户。

[English integration guide](INTEGRATIONS_EN.md)
