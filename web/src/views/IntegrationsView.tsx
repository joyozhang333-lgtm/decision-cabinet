import { isDemoMode } from "../demoApi";

interface Integration {
  id: string;
  name: string;
  subtitle: string;
  status: string;
  description: string;
  command: string;
  preset: string;
  docs: string;
  caution: string;
}

const INTEGRATIONS: Integration[] = [
  {
    id: "codex",
    name: "Codex",
    subtitle: "Codex Plugin + MCP",
    status: "仓库内置插件",
    description: "安装仓库内的 Decision Cabinet 插件后，可在 Codex 对话里搜索知识、展开决策地图并主持四轮私董会。",
    command: "python3 -m pip install 'decision-cabinet[mcp] @ git+https://github.com/joyozhang333-lgtm/decision-cabinet.git@v0.4.0'\ncodex plugin marketplace add joyozhang333-lgtm/decision-cabinet --ref v0.4.0\ncodex plugin add decision-cabinet@decision-cabinet",
    preset: "plugins/decision-cabinet",
    docs: "https://developers.openai.com/codex/mcp/",
    caution: "插件只暴露决策工具，不授予任意文件写入或 Shell 权限。",
  },
  {
    id: "claude-code",
    name: "Claude Code",
    subtitle: "stdio MCP",
    status: "一条命令接入",
    description: "使用 Claude Code 官方 MCP 客户端注册本地服务器，之后可直接让 Claude 召开决策内阁。",
    command: "python3 -m pip install 'decision-cabinet[mcp] @ git+https://github.com/joyozhang333-lgtm/decision-cabinet.git@v0.4.0'\nclaude mcp add decision-cabinet -- decision-cabinet-mcp",
    preset: "plugins/decision-cabinet/.mcp.json",
    docs: "https://code.claude.com/docs/en/mcp",
    caution: "第三方产品不得转用 Claude Free/Pro/Max OAuth；如需反向调用模型，应使用 API Key 或企业云认证。",
  },
  {
    id: "deepseek-harness",
    name: "DeepSeek Harness",
    subtitle: "dsh MCP Client",
    status: "预设配置",
    description: "通过官方 dsh MCP client 把 Decision Cabinet 加进 Cordis composition，保留 Harness 自己的会话编排。",
    command: "git clone --branch v0.4.0 https://github.com/joyozhang333-lgtm/decision-cabinet.git\ncd decision-cabinet && python3 -m pip install -e '.[mcp]'\n# 将仓库预设合并进你的 Cordis composition",
    preset: "plugins/decision-cabinet/presets/deepseek-harness.cordis.yml",
    docs: "https://github.com/deepseek-ai/deepseek-harness",
    caution: "DeepSeek Harness 仍处开发预览期。预设不使用 danger-full-access，也不开放编辑或 Bash。",
  },
  {
    id: "huggingface",
    name: "Hugging Face Tiny Agents / ML Claw",
    subtitle: "Tiny Agents + OpenClaw MCP",
    status: "预设配置",
    description: "Tiny Agents 可直接读取仓库预设；如果“小龙虾”指 Hugging Face ML Claw，则通过其 OpenClaw runtime 的 MCP registry 接入。",
    command: "# Tiny Agents：使用 huggingface-agent.json\n# ML Claw / 当前 OpenClaw runtime：\nopenclaw mcp add decision-cabinet --command decision-cabinet-mcp\nopenclaw mcp doctor decision-cabinet --probe",
    preset: "presets/huggingface-agent.json · presets/mlclaw-openclaw.mcp.json",
    docs: "https://github.com/huggingface/mlclaw",
    caution: "Tiny Agents 已提供预设；ML Claw 托管环境是否允许自定义 MCP 取决于其当前 runtime 与部署权限，不能把两种配置混用。",
  },
  {
    id: "workbuddy",
    name: "腾讯 WorkBuddy",
    subtitle: "自定义 Connector / MCP",
    status: "Connector 接入",
    description: "WorkBuddy 与 CodeBuddy 是两个产品。可把已部署的 Decision Cabinet MCP 服务注册为自定义 Connector。",
    command: "decision-cabinet-mcp --transport streamable-http --host 127.0.0.1 --port 8765 --path /mcp\n# 在前面配置 HTTPS + 鉴权反向代理，再将公网 /mcp URL 填入 WorkBuddy",
    preset: "plugins/decision-cabinet/presets/workbuddy/README.zh-CN.md",
    docs: "https://cloud.tencent.com/document/product/1831/134453",
    caution: "内置服务拒绝非 loopback 绑定且没有公网鉴权；GitHub Pages 不是后端。本版未在 WorkBuddy 企业租户做端到端验证。",
  },
];

export default function IntegrationsView() {
  return (
    <div className="integrations-page">
      <header className="integrations-hero">
        <div>
          <div className="map-kicker">AGENT INTEGRATIONS · 智能体接入</div>
          <h1>把决策内阁带进你常用的 AI 工作台</h1>
          <p>同一个 MCP 服务器，连接不同宿主。顾问知识、四轮议事协议和用户参与方式保持一致。</p>
        </div>
        <div className="integration-protocol"><strong>MCP</strong><span>统一、可审计、默认只读</span></div>
      </header>

      {isDemoMode && (
        <div className="card integration-notice">
          在线 Demo 只展示接入方式，不会在浏览器里探测或启动你电脑上的工具。克隆仓库后，按卡片命令在本地安装。
        </div>
      )}

      <div className="integration-grid">
        {INTEGRATIONS.map((item) => (
          <article className="card integration-card" key={item.id}>
            <div className="integration-card-head">
              <div><h2>{item.name}</h2><span>{item.subtitle}</span></div>
              <b>{item.status}</b>
            </div>
            <p>{item.description}</p>
            <pre><code>{item.command}</code></pre>
            <div className="integration-preset"><span>仓库预设</span><code>{item.preset}</code></div>
            <div className="integration-caution">{item.caution}</div>
            <a href={item.docs} target="_blank" rel="noreferrer">查看官方接入文档 →</a>
          </article>
        ))}
      </div>

      <section className="card integration-boundary">
        <h2>接入边界</h2>
        <div>
          <p><strong>默认只读。</strong> 决策内阁只提供知识检索、决策地图和议事工具，不给宿主任意 Shell 或文件写权限。</p>
          <p><strong>用户自己授权。</strong> 外部模型、企业 Connector 和 API Key 都由使用者配置，仓库不捆绑、不转存凭证。</p>
          <p><strong>名称与成熟度如实标注。</strong> 开发预览、商业产品和可能误称都会在界面与文档中说明。</p>
        </div>
      </section>
    </div>
  );
}
