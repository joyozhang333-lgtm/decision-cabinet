import { useEffect, useState } from "react";
import { getConfig, getUiApiKey, ProductConfig, setUiApiKey } from "./api";
import CouncilView from "./views/CouncilView";
import ChatView from "./views/ChatView";
import DecisionsView from "./views/DecisionsView";
import OrgMemoryView from "./views/OrgMemoryView";
import KnowledgeView from "./views/KnowledgeView";

type Tab = "council" | "knowledge" | "chat" | "decisions" | "org";

const TABS: [Tab, string][] = [
  ["council", "圆桌"],
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
  const remoteHost = !["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);

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
        <nav className="tabs">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              className={tab === key ? "tab active" : "tab"}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="spacer" />
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
      <main className="container">
        {tab === "council" && <CouncilView provider={provider} />}
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
