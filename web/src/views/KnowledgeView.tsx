import { useEffect, useMemo, useState } from "react";
import { KnowledgeCard, listKnowledge } from "../api";

const DOMAINS: [string, string][] = [
  ["", "全部"],
  ["decision", "决策科学"],
  ["business", "商业经营"],
  ["finance", "金融投资"],
  ["management", "管理学"],
  ["wisdom", "传统与世界智慧"],
];

export default function KnowledgeView() {
  const [cards, setCards] = useState<KnowledgeCard[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [domain, setDomain] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      setBusy(true);
      setError("");
      try {
        const result = await listKnowledge(query.trim(), domain);
        setCards(result.cards);
        setStats(result.stats);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query, domain]);

  const sourceCount = useMemo(
    () => new Set(cards.flatMap((card) => card.sources.map((source) => source.url))).size,
    [cards],
  );

  return (
    <div className="knowledge-page">
      <section className="knowledge-hero">
        <div>
          <div className="map-kicker">可追溯知识库</div>
          <h1>知识不是结论，是进入决策的镜头</h1>
          <p>每张卡都说明适用问题、操作方法、边界与来源。现代知识只做摘要，经典原文与解释分开。</p>
        </div>
        <div className="knowledge-stat">
          <strong>{Object.values(stats).reduce((a, b) => a + b, 0) || cards.length}</strong>
          <span>张方法卡 · 当前结果含 {sourceCount} 个来源</span>
        </div>
      </section>

      <div className="knowledge-tools card">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索：股票、现金流、团队、阴阳、人生转折…"
          aria-label="搜索知识库"
        />
        <div className="knowledge-domains">
          {DOMAINS.map(([key, label]) => (
            <button key={key} className={domain === key ? "on" : ""} onClick={() => setDomain(key)}>
              {label}{key && stats[key] ? ` ${stats[key]}` : ""}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="card error">出错了：{error}</div>}
      {busy && cards.length === 0 && <div className="card muted">正在检索知识地图…</div>}

      <div className="knowledge-grid">
        {cards.map((card) => <KnowledgeCardView key={card.id} card={card} />)}
      </div>
      {!busy && cards.length === 0 && <div className="card muted">没有匹配的知识卡。</div>}

      <div className="knowledge-note">
        知识库不内置实时行情，也不复制受版权保护的现代著作全文。投资数据必须回到交易所、监管机构和公司原始披露核验。
      </div>
    </div>
  );
}

function KnowledgeCardView({ card }: { card: KnowledgeCard }) {
  const [open, setOpen] = useState(false);
  return (
    <article className={open ? "knowledge-card open" : "knowledge-card"}>
      <div className="knowledge-card-top">
        <span>{domainLabel(card.domain)}</span>
        <span>{card.tradition === "china" ? "中国" : card.tradition === "international" ? "国际" : "通用"}</span>
      </div>
      <h2>{card.title}</h2>
      <p>{card.summary}</p>
      <div className="knowledge-tags">{card.tags.slice(0, 6).map((tag) => <span key={tag}>{tag}</span>)}</div>
      <button className="link" onClick={() => setOpen((value) => !value)}>{open ? "收起" : "查看方法、边界与来源"}</button>
      {open && (
        <div className="knowledge-detail">
          <Detail title="先问什么" items={card.questions} />
          <Detail title="怎么做" items={card.method} />
          <Detail title="不要越过的边界" items={card.boundaries} />
          <div className="knowledge-sources">
            <h3>来源</h3>
            {card.sources.map((source) => (
              <a key={source.url} href={source.url} target="_blank" rel="noreferrer">
                {source.label}<span>{source.source_type}</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}

function Detail({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return <div><h3>{title}</h3><ul>{items.map((item, index) => <li key={index}>{item}</li>)}</ul></div>;
}

function domainLabel(domain: string): string {
  return Object.fromEntries(DOMAINS)[domain] || domain;
}
