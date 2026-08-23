import { useEffect, useMemo, useRef, useState } from "react";
import { AdvisorPublic, Citation, chat, listAdvisors } from "../api";

interface Msg {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
}

const OPENERS = [
  "我在纠结一个决定，想听听你的视角。",
  "我有个一直绕不过去的卡点。",
  "帮我看看这件事，我是不是在自欺。",
];

const monogram = (name: string) => name.replace(/[·•\s]/g, "").slice(0, 1);

function groupBy(advisors: AdvisorPublic[]) {
  const order: string[] = [];
  const map = new Map<string, AdvisorPublic[]>();
  for (const a of advisors) {
    if (!map.has(a.group)) {
      map.set(a.group, []);
      order.push(a.group);
    }
    map.get(a.group)!.push(a);
  }
  return order.map((g) => ({ group: g, items: map.get(g)! }));
}

export default function ChatView({ provider }: { provider: string }) {
  const [advisors, setAdvisors] = useState<AdvisorPublic[]>([]);
  const [activeId, setActiveId] = useState("");
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [includeMemory, setIncludeMemory] = useState(false);
  const streamRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listAdvisors().then((r) => {
      setAdvisors(r.advisors);
      if (r.advisors[0]) setActiveId(r.advisors[0].id);
    });
  }, []);
  useEffect(() => {
    streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const groups = useMemo(() => groupBy(advisors), [advisors]);
  const active = advisors.find((a) => a.id === activeId);

  function pick(id: string) {
    setActiveId(id);
    setSessionId(undefined);
    setMessages([]);
    setInput("");
  }

  async function send(text?: string) {
    const q = (text ?? input).trim();
    if (!q || !activeId || busy) return;
    setInput("");
    setMessages((p) => [...p, { role: "user", content: q }]);
    setBusy(true);
    try {
      const r = await chat(activeId, q, sessionId, "standard", provider || undefined, includeMemory);
      setSessionId(r.session_id);
      setMessages((p) => [...p, { role: "assistant", content: r.answer, citations: r.citations }]);
    } catch (e) {
      setMessages((p) => [...p, { role: "assistant", content: "出错了：" + (e as Error).message }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="chat2">
      <aside className="roster-rail">
        {groups.map(({ group, items }) => (
          <div className="rail-group" key={group}>
            <div className="rail-label">{group}</div>
            {items.map((a) => (
              <button key={a.id} className={a.id === activeId ? "rail-item on" : "rail-item"} onClick={() => pick(a.id)}>
                <span className={`ava cat-${a.category}`}>{monogram(a.name)}</span>
                <span className="rail-txt">
                  <span className="rail-nm">{a.name}</span>
                  <span className="rail-lg">{a.lineage}</span>
                </span>
              </button>
            ))}
          </div>
        ))}
      </aside>

      <section className="chat2-main card">
        {active && (
          <header className="chat2-head">
            <span className={`ava lg cat-${active.category}`}>{monogram(active.name)}</span>
            <div className="chat2-head-txt">
              <div className="chat2-name">{active.name}</div>
              <div className="chat2-insight">{active.core_insight}</div>
            </div>
          </header>
        )}
        <div className="chat2-stream" ref={streamRef}>
          {messages.length === 0 && active && (
            <div className="chat2-empty">
              <p>用 <b>{active.name}</b> 的公开思想方法来照见你正在想的事。</p>
              <p className="muted">这是方法视角模拟，不是本人、授权代理或对其真实意见的复刻。</p>
              <div className="openers">
                {OPENERS.map((o, i) => (
                  <button key={i} className="opener" onClick={() => send(o)}>{o}</button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`b ${m.role}`}>
              {m.role === "assistant" && active && <span className={`ava sm cat-${active.category}`}>{monogram(active.name)}</span>}
              <div className="b-body">
                <div className="b-text">{m.content}</div>
                {m.citations && m.citations.length > 0 && (
                  <div className="b-cite">依据：{m.citations.map((c) => `《${c.title}》`).join("、")}</div>
                )}
              </div>
            </div>
          ))}
          {busy && (
            <div className="b assistant">
              {active && <span className={`ava sm cat-${active.category}`}>{monogram(active.name)}</span>}
              <div className="b-body"><div className="typing"><i /><i /><i /></div></div>
            </div>
          )}
        </div>
        <div className="chat2-input">
          <textarea
            value={input}
            placeholder={active ? `和 ${active.name} 说说…（Enter 发送，Shift+Enter 换行）` : "…"}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button className="primary" onClick={() => send()} disabled={busy || !input.trim()}>发送</button>
        </div>
        <label className="memory-consent chat-memory">
          <input type="checkbox" checked={includeMemory} onChange={(e) => setIncludeMemory(e.target.checked)} disabled={busy} />
          <span>附带决策档案与最近已决/复盘记录给所选模型（默认关闭）</span>
        </label>
      </section>
    </div>
  );
}
