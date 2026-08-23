import { useEffect, useMemo, useRef, useState } from "react";
import {
  AdvisorPublic,
  ClarifyAnswer,
  ClarifyQuestion,
  DecisionMap,
  DialogueEntry,
  listAdvisors,
  patchDecision,
  requestClarify,
  requestDecisionMap,
  streamClose,
  streamRound,
} from "../api";

const DEPTHS: [string, string][] = [
  ["brief", "简"],
  ["standard", "标准"],
  ["deep", "深"],
];

const CORE_IDS = ["analyst", "investment-analyst", "munger", "drucker", "growth-strategist", "jung", "laozi", "huineng"];
const MAX_ADVISORS_PER_ROUND = 16;

const monogram = (name: string) => name.replace(/[·•\s]/g, "").slice(0, 1);

type Phase = "idle" | "running" | "closing" | "closed";

export default function CouncilView({ provider }: { provider: string }) {
  const [question, setQuestion] = useState("");
  const [depth, setDepth] = useState("standard");
  const [advisors, setAdvisors] = useState<AdvisorPublic[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [clarifyQs, setClarifyQs] = useState<ClarifyQuestion[] | null>(null);
  const [clarifyAns, setClarifyAns] = useState<Record<number, string>>({});
  const [clarifyBusy, setClarifyBusy] = useState(false);
  const [decisionMap, setDecisionMap] = useState<DecisionMap | null>(null);
  const [mapBusy, setMapBusy] = useState(false);
  const [includeMemory, setIncludeMemory] = useState(false);

  const [transcript, setTranscript] = useState<DialogueEntry[]>([]);
  const [round, setRound] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [closeText, setCloseText] = useState("");
  const [decisionId, setDecisionId] = useState<string | null>(null);
  const [founderInput, setFounderInput] = useState("");
  const [error, setError] = useState("");
  const streamRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listAdvisors().then((r) => {
      setAdvisors(r.advisors);
      const present = new Set(r.advisors.map((a) => a.id));
      const core = CORE_IDS.filter((id) => present.has(id));
      setSelected(new Set(core.length ? core : r.advisors.slice(0, 6).map((a) => a.id)));
    });
  }, []);
  useEffect(() => {
    streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight, behavior: "smooth" });
  }, [transcript, closeText]);

  const groupById = useMemo(() => {
    const m = new Map<string, string>();
    advisors.forEach((a) => m.set(a.id, a.group));
    return m;
  }, [advisors]);

  function changeQuestion(next: string) {
    setQuestion(next);
    setClarifyQs(null);
    setClarifyAns({});
    setDecisionMap(null);
    setError("");
  }

  function changeDepth(next: string) {
    setDepth(next);
    setClarifyQs(null);
    setClarifyAns({});
    setDecisionMap(null);
    setError("");
  }

  function changeMemoryConsent(next: boolean) {
    setIncludeMemory(next);
    setClarifyQs(null);
    setClarifyAns({});
    setDecisionMap(null);
    setError("");
  }

  // --- clarify ---
  function buildClarifications(): ClarifyAnswer[] {
    if (!clarifyQs) return [];
    return clarifyQs.map((q, i) => ({ q: q.q, a: (clarifyAns[i] || "").trim() })).filter((c) => c.a);
  }
  function background(): string {
    const answers = buildClarifications().map((c) => `问：${c.q}\n答：${c.a}`).join("\n\n");
    const mapped = decisionMap ? `【已经展开的决策地图】\n${decisionMapText(decisionMap)}` : "";
    return [answers, mapped].filter(Boolean).join("\n\n");
  }

  async function runMap() {
    if (!question.trim() || mapBusy || phase === "running") return;
    setError("");
    setMapBusy(true);
    try {
      const answers = buildClarifications().map((c) => `问：${c.q}\n答：${c.a}`).join("\n\n");
      const mapped = await requestDecisionMap(question, depth, provider || undefined, answers, includeMemory);
      setDecisionMap(mapped);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setMapBusy(false);
    }
  }
  async function runClarify() {
    if (!question.trim() || clarifyBusy || phase === "running") return;
    setError("");
    setClarifyBusy(true);
    try {
      const r = await requestClarify(question, depth, provider || undefined, includeMemory);
      setClarifyQs(r.questions);
      setClarifyAns({});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setClarifyBusy(false);
    }
  }

  // --- rounds ---
  const sendable = () =>
    transcript.map((e) => ({ round: e.round, role: e.role, speaker_id: e.speaker_id, speaker_name: e.speaker_name, content: e.content }));

  async function runRound(idx: number) {
    if (phase === "running" || phase === "closing") return;
    setError("");
    setPhase("running");
    const prior = sendable();
    try {
      await streamRound(
        {
          question,
          depth,
          provider: provider || undefined,
          advisor_ids: Array.from(selected),
          background: background(),
          transcript: prior,
          round_index: idx,
          include_memory: includeMemory,
        },
        {
          turn: (t) => setTranscript((prev) => [...prev, t]),
          done: (d) => setRound(d.round),
          error: (m) => setError(m),
        },
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPhase("idle");
    }
  }

  function startCouncil() {
    if (!question.trim() || !decisionMap || selected.size === 0 || phase === "running") return;
    setTranscript([]);
    setRound(0);
    setCloseText("");
    setDecisionId(null);
    setError("");
    runRound(1);
  }

  function interjectAndContinue() {
    const text = founderInput.trim();
    if (!text || phase === "running") return;
    const entry: DialogueEntry = {
      round, role: "founder", speaker_id: "founder", speaker_name: "我",
      lineage: "", content: text, citations: [], provider: "", model: null,
    };
    setFounderInput("");
    setTranscript((prev) => {
      const next = [...prev, entry];
      // 用最新 transcript 跑下一轮
      setTimeout(() => runRoundWith(next, round + 1), 0);
      return next;
    });
  }

  // 用指定 transcript 跑某轮（供插话后立即带上）
  async function runRoundWith(tr: DialogueEntry[], idx: number) {
    if (phase === "running" || phase === "closing") return;
    setError("");
    setPhase("running");
    const prior = tr.map((e) => ({ round: e.round, role: e.role, speaker_id: e.speaker_id, speaker_name: e.speaker_name, content: e.content }));
    try {
      await streamRound(
        { question, depth, provider: provider || undefined, advisor_ids: Array.from(selected), background: background(), transcript: prior, round_index: idx, include_memory: includeMemory },
        { turn: (t) => setTranscript((prev) => [...prev, t]), done: (d) => setRound(d.round), error: (m) => setError(m) },
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPhase("idle");
    }
  }

  async function closeCouncil() {
    if (phase === "running" || phase === "closing") return;
    setError("");
    setPhase("closing");
    setCloseText("");
    try {
      await streamClose(
        {
          question,
          depth,
          provider: provider || undefined,
          background: background(),
          transcript: sendable(),
          decision_map: decisionMap || undefined,
          include_memory: includeMemory,
        },
        {
          token: (tok) => setCloseText((prev) => prev + tok),
          done: (d) => {
            setDecisionId(d.decision_id);
            setTranscript((prev) => [...prev, d.close]);
            setCloseText("");
            setPhase("closed");
          },
          error: (m) => {
            setError(m);
            setPhase("idle");
          },
        },
      );
    } catch (e) {
      setError((e as Error).message);
      setPhase("idle");
    }
  }

  const started = transcript.length > 0 || phase !== "idle";

  return (
    <div>
      <p className="lead">
        从一个真实问题出发：<span className="em">先看事实，再展开选择与代价，最后观察局势如何演化</span>。
        内阁与你一轮轮讨论，但决定始终属于你。
      </p>

      <div className="card ask">
        <textarea
          placeholder="例如：公司该直接进入新市场，还是先做小规模验证？"
          value={question}
          onChange={(e) => changeQuestion(e.target.value)}
          disabled={started || mapBusy || clarifyBusy}
        />
        <div className="row between" style={{ marginTop: 12 }}>
          <div className="depth-pick">
            {DEPTHS.map(([key, label]) => (
              <button key={key} className={depth === key ? "on" : ""} onClick={() => changeDepth(key)} disabled={started || mapBusy || clarifyBusy}>
                {label}
              </button>
            ))}
          </div>
          {!started && (
            <div className="row" style={{ gap: 8 }}>
              <button className="ghost" onClick={runMap} disabled={mapBusy || !question.trim()}>
                {mapBusy ? "正在展开…" : "先看选择与代价"}
              </button>
              <button className="primary" onClick={runClarify} disabled={clarifyBusy || !question.trim()}>
                {clarifyBusy ? "内阁在拟问题…" : clarifyQs ? "重新厘清" : "让内阁先问我（推荐）"}
              </button>
            </div>
          )}
        </div>
        {!started && (
          <label className="memory-consent">
            <input
              type="checkbox"
              checked={includeMemory}
              onChange={(e) => changeMemoryConsent(e.target.checked)}
              disabled={mapBusy || clarifyBusy}
            />
            <span>本轮向所选模型发送「决策档案」和最近已决/复盘记录（默认关闭）</span>
          </label>
        )}
      </div>

      {!started && clarifyQs && clarifyQs.length > 0 && (
        <div className="card clarify">
          <h3>内阁先问你几句 · 厘清处境</h3>
          <p className="muted clarify-intro">
            私董会的价值，建立在你的真实处境上——下面这些问题既是议事需要的信息，也留给你自己往深处想。答你想答的，可留空、可跳过。
          </p>
          {clarifyQs.map((q, i) => (
            <div className="clarify-q" key={i}>
              <div className="cq-q">{i + 1}. {q.q}</div>
              {q.why && <div className="cq-why">{q.why}</div>}
              <textarea
                value={clarifyAns[i] || ""}
                placeholder="（你的回答，可留空）"
                onChange={(e) => setClarifyAns((p) => ({ ...p, [i]: e.target.value }))}
              />
            </div>
          ))}
          <button className="primary" onClick={runMap} disabled={mapBusy}>
            {mapBusy ? "正在展开局势…" : "带着回答，展开决策地图"}
          </button>
        </div>
      )}

      {!started && decisionMap && (
        <>
          <DecisionMapPanel map={decisionMap} />
          <div className="card map-next">
            <div>
              <strong>地图不是结论。</strong>
              <span className="muted"> 它把讨论的地基、代价与可能演化摆在桌上，接下来让不同视角真正交锋。</span>
            </div>
            <button className="primary" onClick={startCouncil} disabled={selected.size === 0}>带着地图，召开圆桌</button>
          </div>
        </>
      )}

      {!started && <AdvisorPicker advisors={advisors} selected={selected} setSelected={setSelected} />}

      {error && <div className="card error">出错了：{error}</div>}

      {/* 对话流 */}
      {transcript.length > 0 && (
        <div className="card dialogue" ref={streamRef}>
          <div className="dlg-head">
            <h3 style={{ margin: 0 }}>圆桌 · 第 {Math.max(round, 1)} 轮</h3>
            <span className="muted">{question}</span>
          </div>
          {transcript.map((e, i) => (
            <DialogueBubble key={i} e={e} group={groupById.get(e.speaker_id)} />
          ))}
          {phase === "closing" && closeText && (
            <div className="dlg-close">
              <div className="dlg-speaker">主持人 · 收束</div>
              <div className="dlg-text">{closeText}<span className="caret" /></div>
            </div>
          )}
          {phase === "running" && <div className="progress-line">顾问们正在交锋…</div>}
        </div>
      )}

      {/* 控制区 */}
      {started && phase !== "closed" && (
        <div className="card controls">
          {phase === "idle" && transcript.length > 0 && (
            <>
              <div className="founder-say">
                <textarea
                  value={founderInput}
                  placeholder="你想回应、补充、或反问内阁的话…（会带进下一轮）"
                  onChange={(e) => setFounderInput(e.target.value)}
                />
              </div>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                {founderInput.trim() ? (
                  <button className="primary" onClick={interjectAndContinue}>说完这句，继续深入</button>
                ) : (
                  <button className="primary" onClick={() => runRound(round + 1)}>继续深入（第 {round + 1} 轮）</button>
                )}
                <button className="ghost" onClick={closeCouncil}>
                  请内阁收束 · 把决定交回给我
                </button>
              </div>
              {round < 3 && <div className="muted" style={{ marginTop: 8 }}>建议至少议 3 轮，越往后越深。也可以随时插话，把讨论带向你真正在意的地方。</div>}
            </>
          )}
          {(phase === "running" || phase === "closing") && (
            <div className="muted">{phase === "closing" ? "主持人正在收束…" : "议事中…"}</div>
          )}
        </div>
      )}

      {phase === "closed" && decisionId && <ConfirmDecision decisionId={decisionId} decisionMap={decisionMap} />}
    </div>
  );
}

function DialogueBubble({ e, group }: { e: DialogueEntry; group?: string }) {
  if (e.role === "founder") {
    return (
      <div className="dlg-row founder">
        <div className="dlg-bubble me">{e.content}</div>
      </div>
    );
  }
  if (e.role === "facilitator") {
    return (
      <div className="dlg-close final">
        <div className="dlg-speaker">主持人 · 收束</div>
        <div className="dlg-text">{e.content}</div>
      </div>
    );
  }
  return (
    <div className="dlg-row">
      <span className="ava sm">{monogram(e.speaker_name)}</span>
      <div className="dlg-body">
        <div className="dlg-speaker">
          {e.speaker_name}
          {group && <span className="dlg-tag">{group}</span>}
        </div>
        <div className="dlg-text">{e.content}</div>
        {e.citations.length > 0 && (
          <div className="dlg-cite">依据：{e.citations.map((c) => `《${c.title}》`).join("、")}</div>
        )}
      </div>
    </div>
  );
}

function AdvisorPicker({
  advisors,
  selected,
  setSelected,
}: {
  advisors: AdvisorPublic[];
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
}) {
  const groups = useMemo(() => {
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
  }, [advisors]);

  if (advisors.length === 0) return null;

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else if (next.size < MAX_ADVISORS_PER_ROUND) next.add(id);
    setSelected(next);
  }
  function toggleGroup(items: AdvisorPublic[]) {
    const ids = items.map((a) => a.id);
    const allOn = ids.every((id) => selected.has(id));
    const next = new Set(selected);
    ids.forEach((id) => {
      if (allOn) next.delete(id);
      else if (next.size < MAX_ADVISORS_PER_ROUND) next.add(id);
    });
    setSelected(next);
  }
  const core = CORE_IDS.filter((id) => advisors.some((a) => a.id === id));

  return (
    <div className="card roster">
      <div className="roster-head">
        <div className="roster-title">
          参会顾问 <span className="muted">已选 {selected.size} / {advisors.length} 位</span>
        </div>
        <div className="seg">
          <button onClick={() => setSelected(new Set(core))}>核心阵容</button>
          <button onClick={() => setSelected(new Set(advisors.slice(0, MAX_ADVISORS_PER_ROUND).map((a) => a.id)))}>精选 16 位</button>
          <button onClick={() => setSelected(new Set())}>清空</button>
        </div>
      </div>
      <div className="roster-groups">
        {groups.map(({ group, items }) => {
          const on = items.filter((a) => selected.has(a.id)).length;
          const cls = on === items.length ? "rg-label full" : on > 0 ? "rg-label part" : "rg-label";
          return (
            <div className="roster-group" key={group}>
              <button className={cls} onClick={() => toggleGroup(items)} title="点一下整组加入 / 移出">
                {group}
                <span className="rg-count">{on}/{items.length}</span>
              </button>
              <div className="rg-chips">
                {items.map((a) => (
                  <button
                    key={a.id}
                    className={selected.has(a.id) ? "rchip on" : "rchip"}
                    onClick={() => toggle(a.id)}
                    title={`${a.lineage}\n${a.core_insight}`}
                  >
                    {a.name}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="roster-hint muted">每位每轮都会调用一次模型。为控制成本与上下文，每轮最多 16 位；少而精往往议得更深。</div>
    </div>
  );
}

function DecisionMapPanel({ map }: { map: DecisionMap }) {
  const typeLabel: Record<string, string> = {
    business: "商业经营", investment: "投资金融", life: "人生转折", mixed: "综合决策",
  };
  return (
    <section className="map card">
      <div className="map-kicker">决策地图 · {typeLabel[map.decision_type] || map.decision_type}</div>
      <h2>{map.core_question}</h2>
      <div className="map-objective"><span>真正要守住或得到</span>{map.objective}</div>
      {(map.data_as_of || map.facts.length > 0 || map.inferences.length > 0) && (
        <div className="map-lenses">
          <div>
            {map.data_as_of && <div className="map-confidence">数据时点：{map.data_as_of}</div>}
            <MapList title="程序核验的事实" items={map.facts} />
          </div>
          <MapList title="推断与情景假设" items={map.inferences} />
        </div>
      )}

      <div className="map-grid">
        {map.options.map((option, index) => (
          <article className="map-option" key={`${option.name}-${index}`}>
            <div className="map-option-head"><span>选择 {index + 1}</span><strong>{option.name}</strong></div>
            <MapList title="得到什么" items={option.gains} tone="gain" />
            <MapList title="直接代价" items={option.direct_costs} tone="cost" />
            <MapList title="放弃什么" items={option.opportunity_costs} tone="cost" />
            <MapList title="风险" items={option.risks} tone="cost" />
            <MapList title="二阶效应" items={option.second_order_effects} />
            <div className="map-reversible"><span>可逆性</span>{option.reversibility}</div>
          </article>
        ))}
      </div>

      <div className="map-lenses">
        <MapList title="核心张力" items={map.tensions} />
        <MapList title="阴阳循环 · 相反力量如何转换" items={map.yin_yang_cycles} />
      </div>

      <div className="evolution">
        <h3>局势如何演化</h3>
        <div className="evolution-grid">
          {map.evolution_paths.map((path, index) => (
            <article key={`${path.name}-${index}`}>
              <strong>{path.name}</strong>
              <p><span>触发</span>{path.trigger}</p>
              <p><span>近期</span>{path.near_term}</p>
              <p><span>中期</span>{path.medium_term}</p>
              <p><span>信号</span>{path.leading_signals.join("；") || "待补充"}</p>
              <p><span>应对</span>{path.response}</p>
            </article>
          ))}
        </div>
      </div>

      <div className="map-footer-grid">
        <MapList title="拍板前最值钱的证据" items={map.evidence_to_collect} />
        <MapList title="停止 / 退出 / 回滚条件" items={map.stop_conditions} tone="cost" />
      </div>
      {(map.source_urls.length > 0 || map.knowledge_ids.length > 0) && (
        <div className="map-confidence">
          {map.source_urls.length > 0 && (
            <div>来源：{map.source_urls.map((url, index) => (
              <span key={url}>{index ? " · " : ""}<a href={url} target="_blank" rel="noreferrer">相关方法与核验入口 {index + 1}</a></span>
            ))}</div>
          )}
          {map.knowledge_ids.length > 0 && <div>知识卡：{map.knowledge_ids.join(" · ")}</div>}
        </div>
      )}
      <div className="map-confidence">{map.confidence_note}</div>
    </section>
  );
}

function MapList({ title, items, tone = "" }: { title: string; items: string[]; tone?: string }) {
  if (!items.length) return null;
  return (
    <div className={`map-list ${tone}`}>
      <h4>{title}</h4>
      <ul>{items.map((item, index) => <li key={index}>{item}</li>)}</ul>
    </div>
  );
}

function decisionMapText(map: DecisionMap): string {
  const options = map.options.map((option) => (
    `方案 ${option.name}：所得=${option.gains.join("；")}；直接代价=${option.direct_costs.join("；")}；` +
    `机会成本=${option.opportunity_costs.join("；")}；风险=${option.risks.join("；")}；` +
    `二阶效应=${option.second_order_effects.join("；")}；可逆性=${option.reversibility}`
  )).join("\n");
  const paths = map.evolution_paths.map((path) => (
    `${path.name}：触发=${path.trigger}；近期=${path.near_term}；中期=${path.medium_term}；` +
    `信号=${path.leading_signals.join("；")}；应对=${path.response}`
  )).join("\n");
  return [
    `类型：${map.decision_type}`,
    `核心问题：${map.core_question}`,
    `目标：${map.objective}`,
    `数据时点：${map.data_as_of || "未提供"}`,
    `已核实事实：${map.facts.join("；") || "无"}`,
    `推断与情景假设：${map.inferences.join("；") || "无"}`,
    `约束：${map.constraints.join("；")}`,
    options,
    `核心张力：${map.tensions.join("；")}`,
    `阴阳循环：${map.yin_yang_cycles.join("；")}`,
    `演化路径：\n${paths}`,
    `待取证：${map.evidence_to_collect.join("；")}`,
    `停止条件：${map.stop_conditions.join("；")}`,
    `检索来源：${map.source_urls.join("；")}`,
    `知识卡：${map.knowledge_ids.join("；")}`,
  ].join("\n");
}

function ConfirmDecision({ decisionId, decisionMap }: { decisionId: string; decisionMap: DecisionMap | null }) {
  const [chosen, setChosen] = useState("");
  const [rationale, setRationale] = useState("");
  const [expectation, setExpectation] = useState(() => decisionExpectation(decisionMap));
  const [tags, setTags] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");

  async function save() {
    setBusy(true);
    setSaveError("");
    try {
      await patchDecision(decisionId, {
        chosen,
        rationale,
        expectation,
        tags: tags.split(/[，,\s]+/).map((s) => s.trim()).filter(Boolean),
        status: "decided",
      });
      setSaved(true);
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (saved) return <div className="card muted">已存入决策日志 ✓（这是你自己的决定，可在「决策日志」里复盘）</div>;
  return (
    <div className="card">
      <h3>现在，轮到你 · 把你的决定定下来</h3>
      <p className="muted" style={{ marginTop: -4, marginBottom: 12 }}>内阁只负责引你看清，决定是你的。写下你此刻的抉择。</p>
      <div className="form-field">
        <label>我的决定</label>
        <input value={chosen} onChange={(e) => setChosen(e.target.value)} placeholder="例如：先用一个可逆试验验证需求，再决定是否全面投入" />
      </div>
      <div className="form-field">
        <label>我这样定的理由</label>
        <textarea value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="是什么让你落到这个决定" />
      </div>
      <div className="form-field">
        <label>预期、待验证证据与停止条件</label>
        <textarea value={expectation} onChange={(e) => setExpectation(e.target.value)} placeholder="什么证据说明方向正确？什么条件出现时停止、退出或回滚？" />
      </div>
      <div className="form-field">
        <label>标签（逗号分隔）</label>
        <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="市场进入, 可逆试验" />
      </div>
      <button className="primary" onClick={save} disabled={busy || !chosen.trim()}>
        {busy ? "保存中…" : "记下我的决定"}
      </button>
      {saveError && <div className="error" style={{ marginTop: 8 }}>保存失败：{saveError}</div>}
    </div>
  );
}

function decisionExpectation(map: DecisionMap | null): string {
  if (!map) return "";
  return [
    map.objective ? `目标：${map.objective}` : "",
    map.evidence_to_collect.length ? `待验证证据：${map.evidence_to_collect.join("；")}` : "",
    map.stop_conditions.length ? `停止/退出条件：${map.stop_conditions.join("；")}` : "",
  ].filter(Boolean).join("\n");
}
