import { useEffect, useState } from "react";
import { Decision, DecisionMap, listDecisions, reviewDecision } from "../api";

const STATUS_LABEL: Record<string, string> = {
  "": "全部",
  draft: "草稿",
  decided: "已决",
  reviewed: "已复盘",
};

export default function DecisionsView() {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  function load() {
    setLoading(true);
    setError("");
    listDecisions(undefined, statusFilter || undefined)
      .then((r) => setDecisions(r.decisions))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [statusFilter]);

  return (
    <div>
      <p className="lead">每个决策都沉淀在这里。复盘结果会反哺组织记忆，让内阁越来越懂你。</p>
      <div className="row" style={{ marginBottom: 14 }}>
        {["", "draft", "decided", "reviewed"].map((s) => (
          <button key={s} className={statusFilter === s ? "tab active" : "tab"} onClick={() => setStatusFilter(s)}>
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>
      {loading ? (
        <div className="muted">加载中…</div>
      ) : error ? (
        <div className="card error">加载失败：{error}</div>
      ) : decisions.length === 0 ? (
        <div className="card muted">还没有决策。去「圆桌」开一场吧。</div>
      ) : (
        decisions.map((d) => <DecisionCard key={d.id} d={d} onChanged={load} />)
      )}
    </div>
  );
}

function DecisionCard({ d, onChanged }: { d: Decision; onChanged: () => void }) {
  const [outcome, setOutcome] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function review() {
    if (!outcome.trim()) return;
    setBusy(true);
    setError("");
    try {
      await reviewDecision(d.id, outcome.trim());
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="decision-item">
      <div className="title">
        {d.title}
        <span className={`status-badge status-${d.status}`}>{STATUS_LABEL[d.status] ?? d.status}</span>
      </div>
      <div style={{ marginTop: 6 }}>
        {d.tags.map((t) => (
          <span key={t} className="tag">
            {t}
          </span>
        ))}
      </div>
      {d.context && <div className="muted" style={{ marginTop: 8 }}>背景：{d.context}</div>}
      {d.options_considered.length > 0 && (
        <div className="muted" style={{ marginTop: 6 }}>曾比较：{d.options_considered.join(" / ")}</div>
      )}
      {d.chosen && <div style={{ marginTop: 6 }}>选择：{d.chosen}</div>}
      {d.rationale && <div className="muted" style={{ marginTop: 4 }}>理由：{d.rationale}</div>}
      {d.expectation && (
        <div className="dissent" style={{ marginTop: 8, whiteSpace: "pre-line" }}>
          <div className="label">预期与停止条件</div>
          {d.expectation}
        </div>
      )}
      {d.decision_map && <DecisionMapSnapshot map={d.decision_map} />}
      {d.review_outcome && (
        <div style={{ marginTop: 8 }} className="dissent">
          <div className="label">复盘</div>
          {d.review_outcome}
        </div>
      )}
      {d.status !== "reviewed" && (
        <div className="row" style={{ marginTop: 10 }}>
          <input
            style={{ flex: 1, border: "1px solid var(--line)", borderRadius: 10, padding: "8px 12px" }}
            placeholder="复盘：后来结果如何？"
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
          />
          <button className="ghost" onClick={review} disabled={busy || !outcome.trim()}>
            记录复盘
          </button>
        </div>
      )}
      {error && <div className="error" style={{ marginTop: 8 }}>复盘保存失败：{error}</div>}
    </div>
  );
}

function DecisionMapSnapshot({ map }: { map: DecisionMap }) {
  return (
    <details className="dissent" style={{ marginTop: 8 }}>
      <summary style={{ cursor: "pointer", fontWeight: 700 }}>查看完整决策地图快照</summary>
      <div style={{ marginTop: 10 }}>
        {map.data_as_of && <p><b>数据时点：</b>{map.data_as_of}</p>}
        <p><b>核心张力：</b>{map.tensions.join("；") || "待补充"}</p>
        <p><b>阴阳循环：</b>{map.yin_yang_cycles.join("；") || "待补充"}</p>
        <div><b>选项与风险：</b></div>
        <ul>{map.options.map((option, index) => (
          <li key={`${option.name}-${index}`}>
            {option.name}｜代价：{option.direct_costs.join("；") || "待补充"}｜
            风险：{option.risks.join("；") || "待补充"}｜可逆性：{option.reversibility || "待判断"}
          </li>
        ))}</ul>
        <div><b>演化路径：</b></div>
        <ul>{map.evolution_paths.map((path, index) => (
          <li key={`${path.name}-${index}`}>
            {path.name}｜触发：{path.trigger}｜领先信号：{path.leading_signals.join("；") || "待补充"}｜应对：{path.response}
          </li>
        ))}</ul>
        {map.source_urls.length > 0 && (
          <p><b>来源：</b>{map.source_urls.map((url, index) => (
            <span key={url}>{index ? " · " : ""}<a href={url} target="_blank" rel="noreferrer">来源 {index + 1}</a></span>
          ))}</p>
        )}
      </div>
    </details>
  );
}
