import { useEffect, useState } from "react";
import { getConfig, getUiApiKey, ProductConfig, setUiApiKey } from "./api";
import { clearDemoSessionData, isDemoMode } from "./demoApi";
import CouncilView from "./views/CouncilView";
import ChatView from "./views/ChatView";
import DecisionsView from "./views/DecisionsView";
import OrgMemoryView from "./views/OrgMemoryView";
import KnowledgeView from "./views/KnowledgeView";
import IntegrationsView from "./views/IntegrationsView";

type Tab = "council" | "integrations" | "knowledge" | "chat" | "decisions" | "org";

const TABS: [Tab, string][] = [
  ["council", "私董会"],
  ["integrations", "接入中心"],
  ["knowledge", "知识地图"],
  ["chat", "单聊"],
  ["decisions", "决策日志"],
  ["org", "决策档案"],
];

export default function App() {
  const [tab, setTab] = useState<Tab>("council");
  const [config, setConfig] = useState<ProductConfig | null>(null);
  const [provider, setProvider] = useState<string>("");
  const [uiKey, setUiKeyState] = useState(() => getUiApiKey());
  const remoteHost = !isDemoMode && !["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);

  useEffect(() => {
    getConfig().then(setConfig).catch(() => setConfig(null));
  }, []);

  const providerEntries = config ? Object.entries(config.providers.providers) : [];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          决策内阁<span className="en">DECISION CABINET</span>
        </div>
        <nav className="tabs" role="tablist" aria-label="主导航">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              className={tab === key ? "tab active" : "tab"}
              onClick={() => setTab(key)}
              role="tab"
              aria-selected={tab === key}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="spacer" />
        {isDemoMode ? (
          <div className="demo-mode-pill">浏览器演示 · 不上传数据</div>
        ) : (
          <div className="provider-pick">
            <span>模型</span>
            <select value={provider} onChange={(e) => setProvider(e.target.value)}>
              <option value="">默认（{config?.providers.default ?? "deepseek"}）</option>
              {providerEntries.map(([name, info]) => (
                <option key={name} value={name}>
                  {name}
                  {info.configured ? "" : "·未配置"}
                </option>
              ))}
            </select>
          </div>
        )}
        {remoteHost && (
          <div className="provider-pick">
            <span>访问密钥</span>
            <input
              type="password"
              value={uiKey}
              placeholder="CABINET_UI_API_KEY"
              onChange={(e) => setUiKeyState(e.target.value)}
              onBlur={() => { setUiApiKey(uiKey); window.location.reload(); }}
              aria-label="远程访问密钥"
            />
          </div>
        )}
      </header>
      {isDemoMode && (
        <div className="demo-banner">
          <span><b>在线体验版</b>：内置演示回应，数据只保存在当前标签页会话，不调用外部模型。</span>
          <div>
            <button onClick={() => { clearDemoSessionData(); window.location.reload(); }}>清除本页数据</button>
            <a href="https://github.com/joyozhang333-lgtm/decision-cabinet">获取完整开源版</a>
          </div>
        </div>
      )}
      <main className="container">
        <section hidden={tab !== "council"} aria-label="私董会">
          <CouncilView provider={provider} />
        </section>
        {tab === "integrations" && <IntegrationsView />}
        {tab === "knowledge" && <KnowledgeView />}
        {tab === "chat" && <ChatView provider={provider} />}
        {tab === "decisions" && <DecisionsView />}
        {tab === "org" && <OrgMemoryView />}
      </main>
      <footer className="footer">
        决策内阁只提供教育与决策支持，不构成投资、法律、医疗或税务建议，也不保证任何结果。
      </footer>
    </div>
  );
}
