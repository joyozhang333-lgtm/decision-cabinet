import { useEffect, useMemo, useRef, useState } from "react";
import {
  AdvisorPublic,
  ClarifyAnswer,
  ClarifyQuestion,
  DecisionMap,
  DialogueEntry,
  Participation,
  ParticipationMode,
  RoundAgenda,
  RoundSummary,
  listAdvisors,
  patchDecision,
  requestClarify,
  requestDecisionMap,
  streamClose,
  streamRound,
} from "../api";
import { isDemoMode } from "../demoApi";

const DEPTHS: [string, string][] = [
  ["brief", "简"],
  ["standard", "标准"],
  ["deep", "深"],
];

const CORE_IDS = ["analyst", "investment-analyst", "munger", "drucker", "growth-strategist", "jung", "laozi", "huineng"];
const MAX_ADVISORS_PER_ROUND = 16;
const ROUND_LABELS = [
  [1, "事实定界"],
  [2, "聚焦争议"],
  [3, "压力测试"],
  [4, "条件收束"],
] as const;

const monogram = (name: string) => name.replace(/[·•\s]/g, "").slice(0, 1);

type Phase = "idle" | "running" | "closing" | "closed";

interface RoundAttempt {
  roundIndex: number;
  participation: Participation;
  founderEntry: DialogueEntry | null;
  baseTranscript: DialogueEntry[];
  priorSummaries: RoundSummary[];
  advisorIds: string[];
  background: string;
  question: string;
  depth: string;
  provider?: string;
  includeMemory: boolean;
}

interface PendingRound {
  attempt: RoundAttempt;
  agenda?: RoundAgenda;
  turns: DialogueEntry[];
  summary?: RoundSummary;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

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
  const [agendas, setAgendas] = useState<Record<number, RoundAgenda>>({});
  const [summaries, setSummaries] = useState<Record<number, RoundSummary>>({});
  const [round, setRound] = useState(0);
  const [activeRound, setActiveRound] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [closeText, setCloseText] = useState("");
  const [decisionId, setDecisionId] = useState<string | null>(null);
  const [founderInput, setFounderInput] = useState("");
  const [participationMode, setParticipationMode] = useState<ParticipationMode>("answer");
  const [answerQuestionIndex, setAnswerQuestionIndex] = useState(0);
  const [error, setError] = useState("");
  const [sessionStarted, setSessionStarted] = useState(false);
  const [pendingRound, setPendingRound] = useState<PendingRound | null>(null);
  const [retryAttempt, setRetryAttempt] = useState<RoundAttempt | null>(null);
  const [retryClose, setRetryClose] = useState(false);
  const requestController = useRef<AbortController | null>(null);
  const requestSerial = useRef(0);

  useEffect(() => {
    let cancelled = false;
    listAdvisors().then((r) => {
      if (cancelled) return;
      setAdvisors(r.advisors);
      const present = new Set(r.advisors.map((a) => a.id));
      const core = CORE_IDS.filter((id) => present.has(id));
      setSelected(new Set(core.length ? core : r.advisors.slice(0, 6).map((a) => a.id)));
    });
    return () => {
      cancelled = true;
      requestSerial.current += 1;
      requestController.current?.abort();
      requestController.current = null;
    };
  }, []);
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

  function startNewDecision() {
    requestSerial.current += 1;
    requestController.current?.abort();
    requestController.current = null;
    setQuestion("");
    setClarifyQs(null);
    setClarifyAns({});
    setDecisionMap(null);
    setTranscript([]);
    setAgendas({});
    setSummaries({});
    setRound(0);
    setActiveRound(0);
    setPhase("idle");
    setCloseText("");
    setDecisionId(null);
    setFounderInput("");
    setParticipationMode("answer");
    setAnswerQuestionIndex(0);
    setError("");
    setSessionStarted(false);
    setPendingRound(null);
    setRetryAttempt(null);
    setRetryClose(false);
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
  const summaryList = () => Object.values(summaries).sort((a, b) => a.round - b.round);
  const sendable = (items = transcript) => items.map((e) => ({
    round: e.round,
    role: e.role,
    speaker_id: e.speaker_id,
    speaker_name: e.speaker_name,
    content: e.content,
    entry_id: e.entry_id,
    reply_to_id: e.reply_to_id,
    reply_to_name: e.reply_to_name,
    reply_excerpt: e.reply_excerpt,
    stance: e.stance,
    novelty: e.novelty,
    participation_mode: e.participation_mode,
    delta_type: e.delta_type || "",
    delta: e.delta || "",
  }));

  function beginStreamRequest() {
    requestSerial.current += 1;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    return { controller, serial: requestSerial.current };
  }

  async function runRoundAttempt(attempt: RoundAttempt) {
    if (attempt.roundIndex < 1 || attempt.roundIndex > 4) return;
    const { controller, serial } = beginStreamRequest();
    const isCurrent = () => requestSerial.current === serial;
    let stagedAgenda: RoundAgenda | undefined;
    let stagedTurns: DialogueEntry[] = [];
    let stagedSummary: RoundSummary | undefined;
    let donePayload: { round?: number; turns?: DialogueEntry[]; summary?: RoundSummary } | null = null;

    setError("");
    setRetryAttempt(null);
    setRetryClose(false);
    setActiveRound(attempt.roundIndex);
    setPhase("running");
    setPendingRound({ attempt, turns: [] });
    try {
      await streamRound(
        {
          question: attempt.question,
          depth: attempt.depth,
          provider: attempt.provider,
          advisor_ids: attempt.advisorIds,
          background: attempt.background,
          transcript: sendable([
            ...attempt.baseTranscript,
            ...(attempt.founderEntry ? [attempt.founderEntry] : []),
          ]),
          summaries: attempt.priorSummaries,
          participation: attempt.participation,
          round_index: attempt.roundIndex,
          include_memory: attempt.includeMemory,
        },
        {
          agenda: (agenda) => {
            stagedAgenda = agenda;
            if (isCurrent()) setPendingRound((prev) => prev ? { ...prev, agenda } : prev);
          },
          turn: (turn) => {
            stagedTurns = [...stagedTurns, turn];
            if (isCurrent()) setPendingRound((prev) => prev ? { ...prev, turns: stagedTurns } : prev);
          },
          roundSummary: (summary) => {
            stagedSummary = summary;
            if (isCurrent()) setPendingRound((prev) => prev ? { ...prev, summary } : prev);
          },
          done: (done) => { donePayload = done; },
        },
        controller.signal,
      );
      if (!isCurrent()) return;

      const completed = donePayload as { round?: number; turns?: DialogueEntry[]; summary?: RoundSummary } | null;
      const completedRound = completed?.round;
      const committedAgenda = stagedAgenda;
      const committedTurns = Array.isArray(completed?.turns) ? completed.turns : stagedTurns;
      const committedSummary = completed?.summary || stagedSummary;
      if (completedRound !== attempt.roundIndex || !committedAgenda || !committedSummary) {
        throw new Error("本轮响应不完整，已撤回未完成内容，请重试本轮。");
      }

      setTranscript([
        ...attempt.baseTranscript,
        ...(attempt.founderEntry ? [attempt.founderEntry] : []),
        ...committedTurns,
      ]);
      setAgendas((prev) => ({ ...prev, [attempt.roundIndex]: committedAgenda }));
      setSummaries((prev) => ({ ...prev, [attempt.roundIndex]: committedSummary }));
      setAnswerQuestionIndex(0);
      setRound(attempt.roundIndex);
      setPendingRound(null);
      setRetryAttempt(null);
    } catch (e) {
      if (!isCurrent() || isAbortError(e)) return;
      setPendingRound(null);
      setRetryAttempt(attempt);
      setError(`${(e as Error).message} 本轮尚未计入议事记录。`);
    } finally {
      if (isCurrent()) {
        requestController.current = null;
        setPhase("idle");
        setActiveRound(0);
      }
    }
  }

  function startCouncil() {
    if (!question.trim() || !decisionMap || selected.size < 2 || phase === "running") return;
    setTranscript([]);
    setAgendas({});
    setSummaries({});
    setRound(0);
    setCloseText("");
    setDecisionId(null);
    setError("");
    setSessionStarted(true);
    setPendingRound(null);
    setRetryAttempt(null);
    const attempt: RoundAttempt = {
      roundIndex: 1,
      participation: { mode: "listen", content: "" },
      founderEntry: null,
      baseTranscript: [],
      priorSummaries: [],
      advisorIds: Array.from(selected),
      background: background(),
      question,
      depth,
      provider: provider || undefined,
      includeMemory,
    };
    void runRoundAttempt(attempt);
  }

  function continueCouncil(mode: ParticipationMode) {
    if (phase !== "idle" || round >= 4) return;
    const typed = founderInput.trim();
    if (mode !== "listen" && !typed) return;
    const content = mode === "listen"
      ? "我先旁听。请你们围绕还没有解决的分歧继续内部讨论。"
      : typed;
    const nextRound = round + 1;
    const answeredQuestion = mode === "answer" ? latestSummary?.questions_for_user[answerQuestionIndex] || "" : "";
    const participation: Participation = {
      mode,
      content: typed,
      ...(answeredQuestion ? {
        reply_to_id: `summary-r${round}-q${answerQuestionIndex}`,
        reply_to_name: "委员会提问",
        reply_excerpt: answeredQuestion,
      } : {}),
    };
    const entry: DialogueEntry = {
      round: nextRound, role: "founder", speaker_id: "founder", speaker_name: "我",
      lineage: "", content, citations: [], provider: "", model: null,
      entry_id: `founder-${Date.now()}`,
      reply_to_id: participation.reply_to_id || "",
      reply_to_name: participation.reply_to_name || "",
      reply_excerpt: participation.reply_excerpt || "",
      stance: "propose", novelty: typed ? "new" : "refined", participation_mode: mode,
      delta_type: typed ? (mode === "add" ? "new_evidence" : mode === "focus" ? "condition" : "position_change") : "none",
      delta: typed,
    };
    setFounderInput("");
    const attempt: RoundAttempt = {
      roundIndex: nextRound,
      participation,
      founderEntry: entry,
      baseTranscript: [...transcript],
      priorSummaries: summaryList(),
      advisorIds: Array.from(selected),
      background: background(),
      question,
      depth,
      provider: provider || undefined,
      includeMemory,
    };
    void runRoundAttempt(attempt);
  }

  function reviseRetry() {
    if (!retryAttempt) return;
    setParticipationMode(retryAttempt.participation.mode);
    setFounderInput(retryAttempt.participation.mode === "listen" ? "" : retryAttempt.participation.content);
    setRetryAttempt(null);
    setError("");
  }

  async function closeCouncil() {
    if (phase === "running" || phase === "closing") return;
    const { controller, serial } = beginStreamRequest();
    const isCurrent = () => requestSerial.current === serial;
    let stagedText = "";
    let donePayload: { decision_id?: string; close?: DialogueEntry } | null = null;
    setError("");
    setRetryAttempt(null);
    setRetryClose(false);
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
          summaries: summaryList(),
          decision_map: decisionMap || undefined,
          include_memory: includeMemory,
        },
        {
          token: (tok) => {
            stagedText += tok;
            if (isCurrent()) setCloseText(stagedText);
          },
          done: (done) => { donePayload = done; },
        },
        controller.signal,
      );
      if (!isCurrent()) return;
      const completed = donePayload as { decision_id?: string; close?: DialogueEntry } | null;
      if (!completed?.decision_id || !completed.close) {
        throw new Error("收束响应不完整，请重试收束。");
      }
      setDecisionId(completed.decision_id);
      setTranscript((prev) => [...prev, completed.close!]);
      setCloseText("");
      setPhase("closed");
    } catch (e) {
      if (!isCurrent() || isAbortError(e)) return;
      setCloseText("");
      setRetryClose(true);
      setError(`${(e as Error).message} 未完成的收束内容没有写入记录。`);
      setPhase("idle");
    } finally {
      if (isCurrent()) requestController.current = null;
    }
  }

  const started = sessionStarted;
  const shownRounds = Array.from(new Set([
    ...Object.keys(agendas).map(Number),
    ...transcript.filter((entry) => entry.round > 0).map((entry) => entry.round),
    ...(pendingRound ? [pendingRound.attempt.roundIndex] : []),
  ])).sort((a, b) => a - b);
  const expandedRound = activeRound || shownRounds.at(-1) || 0;
  const latestSummary = summaries[round];

  return (
    <div>
      <p className="lead">
        从一个真实问题出发：<span className="em">先看事实，再展开选择与代价，最后观察局势如何演化</span>。
        内阁与你一轮轮讨论，但决定始终属于你。
      </p>

      <div className="card ask">
        <label className="sr-only" htmlFor="decision-question">你要讨论的决策</label>
        <textarea
          id="decision-question"
          placeholder="例如：公司该直接进入新市场，还是先做小规模验证？"
          value={question}
          maxLength={4000}
          onChange={(e) => changeQuestion(e.target.value)}
          disabled={started || mapBusy || clarifyBusy}
        />
        {!started && <div className="input-count" aria-live="polite">{question.length} / 4000</div>}
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
            <span>{isDemoMode ? "本轮使用当前标签页的临时决策档案（不会上传，关闭标签页后清除）" : "本轮向所选模型发送「决策档案」和最近已决/复盘记录（默认关闭）"}</span>
          </label>
        )}
      </div>

      {!started && clarifyQs && clarifyQs.length > 0 && (
        <div className="card clarify">
          <h3>内阁先问你几句 · 厘清处境</h3>
          <p className="muted clarify-intro">
            私董会的价值，建立在你的真实处境上——下面这些问题既是议事需要的信息，也留给你自己往深处想。答你想答的，可留空、可跳过。
          </p>
          {clarifyQs.map((q, i) => {
            const inputId = `clarify-answer-${i}`;
            const whyId = `clarify-why-${i}`;
            return (
              <div className="clarify-q" key={i}>
                <label className="cq-q" htmlFor={inputId}>{i + 1}. {q.q}</label>
                {q.why && <div className="cq-why" id={whyId}>{q.why}</div>}
                <textarea
                  id={inputId}
                  aria-describedby={q.why ? whyId : undefined}
                  value={clarifyAns[i] || ""}
                  placeholder="（你的回答，可留空）"
                  onChange={(e) => setClarifyAns((p) => ({ ...p, [i]: e.target.value }))}
                />
              </div>
            );
          })}
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
            <button className="primary" onClick={startCouncil} disabled={selected.size < 2}>带着地图，召开圆桌</button>
          </div>
        </>
      )}

      {!started && <AdvisorPicker advisors={advisors} selected={selected} setSelected={setSelected} />}

      {error && (
        <div className="card error stream-error" role="alert">
          <span>出错了：{error}</span>
          {retryAttempt && phase === "idle" && (
            <div className="row">
              <button className="primary" onClick={() => void runRoundAttempt(retryAttempt)}>
                重试第 {retryAttempt.roundIndex} 轮
              </button>
              <button className="ghost" onClick={reviseRetry}>修改我的参与方式</button>
            </div>
          )}
          {retryClose && phase === "idle" && (
            <button className="primary" onClick={() => void closeCouncil()}>重试收束</button>
          )}
        </div>
      )}

      {started && (
        <>
          <RoundStepper completedRound={round} activeRound={activeRound} />
          <div className="council-stage">
            <section
              className="council-thread"
              role="log"
              aria-live="polite"
              aria-relevant="additions"
              aria-busy={phase === "running"}
              aria-label="私董会对话记录"
            >
              {shownRounds.map((roundIndex) => (
                <RoundSection
                  key={roundIndex}
                  roundIndex={roundIndex}
                  agenda={pendingRound?.attempt.roundIndex === roundIndex ? pendingRound.agenda : agendas[roundIndex]}
                  entries={[
                    ...transcript.filter((entry) => entry.round === roundIndex),
                    ...(pendingRound?.attempt.roundIndex === roundIndex
                      ? [
                        ...(pendingRound.attempt.founderEntry ? [pendingRound.attempt.founderEntry] : []),
                        ...pendingRound.turns,
                      ]
                      : []),
                  ]}
                  groupById={groupById}
                  pending={pendingRound?.attempt.roundIndex === roundIndex}
                  open={roundIndex === expandedRound}
                />
              ))}
              {phase === "running" && (
                <div className="card progress-line" role="status">第 {activeRound} 轮议事中，委员正在回应彼此…</div>
              )}
              {phase === "closing" && closeText && (
                <div className="dlg-close">
                  <div className="dlg-speaker">主持人 · 收束</div>
                  <div className="dlg-text">{closeText}<span className="caret" /></div>
                </div>
              )}
            </section>
            <aside className="minutes-rail" aria-label="各轮议事纪要">
              {summaryList().map((summary) => <RoundSummaryPanel key={summary.round} summary={summary} open={summary.round === round} />)}
              {summaryList().length === 0 && (
                <div className="card minutes-empty">本轮结束后，这里会出现各方观点、共识与非共识。</div>
              )}
            </aside>
          </div>
        </>
      )}

      {/* 控制区 */}
      {started && phase !== "closed" && (
        <div className="card controls">
          {phase === "idle" && !retryAttempt && !retryClose && transcript.length > 0 && round < 4 && (
            <FounderParticipation
              mode={participationMode}
              setMode={setParticipationMode}
              value={founderInput}
              setValue={setFounderInput}
              questions={latestSummary?.questions_for_user || []}
              answerQuestionIndex={answerQuestionIndex}
              setAnswerQuestionIndex={setAnswerQuestionIndex}
              nextRound={round + 1}
              onContinue={continueCouncil}
              onClose={closeCouncil}
            />
          )}
          {phase === "idle" && !retryClose && round === 4 && (
            <div className="round-complete">
              <div><strong>四轮议事已完成。</strong><span className="muted"> 现在请主持人保留少数意见，把决定权交回给你。</span></div>
              <button className="primary" onClick={closeCouncil}>请内阁收束</button>
            </div>
          )}
          {(phase === "running" || phase === "closing") && (
            <div className="muted">{phase === "closing" ? "主持人正在收束…" : "议事中…"}</div>
          )}
        </div>
      )}

      {phase === "closed" && decisionId && (
        <ConfirmDecision decisionId={decisionId} decisionMap={decisionMap} onStartNew={startNewDecision} />
      )}
    </div>
  );
}

function RoundStepper({ completedRound, activeRound }: { completedRound: number; activeRound: number }) {
  return (
    <ol className="round-stepper" aria-label="四轮私董会进程">
      {ROUND_LABELS.map(([index, label]) => {
        const state = activeRound === index ? "active" : completedRound >= index ? "done" : "upcoming";
        return (
          <li key={index} className={state} aria-current={activeRound === index ? "step" : undefined}>
            <span>{completedRound >= index ? "✓" : index}</span>
            <strong>{label}</strong>
          </li>
        );
      })}
    </ol>
  );
}

function RoundSection({
  roundIndex,
  agenda,
  entries,
  groupById,
  pending,
  open,
}: {
  roundIndex: number;
  agenda?: RoundAgenda;
  entries: DialogueEntry[];
  groupById: Map<string, string>;
  pending?: boolean;
  open: boolean;
}) {
  return (
    <details className={`card round-section${pending ? " pending" : ""}`} open={open}>
      <summary className="round-head">
        <span>第 {roundIndex} 轮{pending ? " · 进行中" : ""}</span>
        <div>
          <h2>{agenda?.title || ROUND_LABELS[roundIndex - 1]?.[1]}</h2>
          {agenda?.objective && <p>{agenda.objective}</p>}
        </div>
        <span className="round-chevron" aria-hidden="true">⌄</span>
      </summary>
      {agenda?.topics?.length ? (
        <div className="round-agenda"><strong>本轮议题</strong>{agenda.topics.map((topic) => <span key={topic}>{topic}</span>)}</div>
      ) : null}
      <div className="dialogue">
        {entries.map((entry) => (
          <DialogueBubble key={entry.entry_id || `${entry.speaker_id}-${entry.content}`} e={entry} group={groupById.get(entry.speaker_id)} />
        ))}
      </div>
    </details>
  );
}

const STANCE_LABELS: Record<string, string> = {
  propose: "提出观点", support: "支持并推进", challenge: "质疑", refine: "补充修正", abstain: "暂不新增", synthesize: "综合",
};
const DELTA_LABELS: Record<string, string> = {
  claim: "新增主张",
  new_evidence: "新增证据", counterexample: "新增反例", condition: "新增条件",
  position_change: "立场变化", evidence_request: "证据要求",
};

function DialogueBubble({ e, group }: { e: DialogueEntry; group?: string }) {
  if (e.role === "founder") {
    const intent = ({ answer: "回答内阁", add: "补充事实", focus: "指定争议", listen: "先旁听" } as Record<string, string>)[e.participation_mode] || "我的发言";
    return (
      <div className="dlg-row founder">
        <div>
          <div className="founder-intent">
            {intent}
            {e.participation_mode !== "listen" && <span className="stance propose">我的观点</span>}
          </div>
          {e.reply_to_name && (
            <div className="founder-reply">
              回应 {e.reply_to_name}{e.reply_excerpt ? <span>“{e.reply_excerpt}”</span> : null}
            </div>
          )}
          <div className="dlg-bubble me">{e.content}</div>
        </div>
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
          <span className={`stance ${e.stance}`}>{STANCE_LABELS[e.stance] || e.stance}</span>
        </div>
        {e.reply_to_name && (
          <div className="reply-link">
            回应 {e.reply_to_name}{e.reply_excerpt ? <span>“{e.reply_excerpt}”</span> : null}
          </div>
        )}
        <div className="dlg-text">{e.content}</div>
        {e.delta && e.delta_type && e.delta_type !== "none" && (
          <div className="turn-delta">
            <strong>{DELTA_LABELS[e.delta_type] || "本轮新增"}</strong>
            <span>{e.delta}</span>
          </div>
        )}
        {e.citations.length > 0 && (
          <div className="dlg-cite">依据：{e.citations.map((c) => `《${c.title}》`).join("、")}</div>
        )}
      </div>
    </div>
  );
}

function RoundSummaryPanel({ summary, open }: { summary: RoundSummary; open: boolean }) {
  return (
    <details className="card minutes" open={open}>
      <summary><span>第 {summary.round} 轮纪要</span><strong>{summary.title}</strong></summary>
      <MinuteBlock title="讨论议题" items={summary.topics} />
      <div className="minute-block">
        <h4>各方观点</h4>
        {summary.positions.map((position) => (
          <div className="position" key={`${summary.round}-${position.speaker_id}`}>
            <strong>{position.speaker_id === "founder" ? "我的观点" : position.speaker_name}</strong>
            <span>{STANCE_LABELS[position.stance] || position.stance}{position.responds_to_name ? ` · 回应 ${position.responds_to_name}` : ""}</span>
            <p>{position.claim}</p>
          </div>
        ))}
      </div>
      <MinuteBlock title={summary.round === 1 ? "小结论" : "本轮推进"} items={summary.provisional_conclusions} />
      <MinuteBlock title="共识结论" items={summary.consensus} tone="consensus" />
      <MinuteBlock title="非共识结论" items={summary.dissents} tone="dissent" />
      <MinuteBlock title="想听你说" items={summary.questions_for_user} tone="question" />
    </details>
  );
}

function MinuteBlock({ title, items, tone = "" }: { title: string; items: string[]; tone?: string }) {
  if (!items.length) return null;
  return (
    <div className={`minute-block ${tone}`}>
      <h4>{title}</h4>
      <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>
    </div>
  );
}

function FounderParticipation({
  mode, setMode, value, setValue, questions, answerQuestionIndex, setAnswerQuestionIndex,
  nextRound, onContinue, onClose,
}: {
  mode: ParticipationMode;
  setMode: (mode: ParticipationMode) => void;
  value: string;
  setValue: (value: string) => void;
  questions: string[];
  answerQuestionIndex: number;
  setAnswerQuestionIndex: (index: number) => void;
  nextRound: number;
  onContinue: (mode: ParticipationMode) => void;
  onClose: () => void;
}) {
  const question = questions[answerQuestionIndex] || "";
  const actions: [ParticipationMode, string, string][] = [
    ["answer", "回答内阁", "回应他们刚才问你的问题"],
    ["add", "补充事实", "加入他们还不知道的信息"],
    ["focus", "指定争议", "要求下一轮围绕一个冲突深入"],
    ["listen", "先旁听", "不补充，让委员内部继续交锋"],
  ];
  const placeholder = {
    answer: question || "你对本轮提问的回答…",
    add: "补充新的事实、数字、约束或你的判断…",
    focus: "下一轮我希望你们重点争论的是…",
    listen: "",
  }[mode];
  return (
    <div className="participation">
      <div className="participation-head">
        <div><span>轮到你</span><strong>你可以说，也可以只听</strong></div>
        {question && (
          <blockquote>
            {mode === "answer" && questions.length > 1 ? (
              <label>
                <span>选择要回答的问题</span>
                <select
                  value={answerQuestionIndex}
                  onChange={(event) => setAnswerQuestionIndex(Number(event.target.value))}
                >
                  {questions.map((item, index) => <option key={`${index}-${item}`} value={index}>{item}</option>)}
                </select>
              </label>
            ) : question}
          </blockquote>
        )}
      </div>
      <fieldset className="participation-actions">
        <legend className="sr-only">选择参与方式</legend>
        {actions.map(([key, label, description]) => (
          <label key={key} className={mode === key ? "active" : ""}>
            <input
              type="radio"
              name={`round-${nextRound}-participation`}
              value={key}
              checked={mode === key}
              onChange={() => setMode(key)}
            />
            <span className="participation-option">
              <strong>{label}</strong><span>{description}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {mode !== "listen" && (
        <div className="founder-say">
          <label className="sr-only" htmlFor="founder-input">你的发言</label>
          <textarea
            id="founder-input"
            value={value}
            maxLength={4000}
            placeholder={placeholder}
            onChange={(event) => setValue(event.target.value)}
          />
        </div>
      )}
      <div className="participation-submit">
        <button className="primary" onClick={() => onContinue(mode)} disabled={mode !== "listen" && !value.trim()}>
          {mode === "listen" ? `旁听第 ${nextRound} 轮` : `带着这句话进入第 ${nextRound} 轮`}
        </button>
        <button className="ghost" onClick={onClose}>现在收束</button>
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
      <div className="roster-groups" aria-label="按领域选择参会顾问">
        {groups.map(({ group, items }) => {
          const on = items.filter((a) => selected.has(a.id)).length;
          const cls = on === items.length ? "rg-label full" : on > 0 ? "rg-label part" : "rg-label";
          return (
            <div className="roster-group" key={group}>
              <button
                className={cls}
                onClick={() => toggleGroup(items)}
                title="点一下整组加入 / 移出"
                aria-pressed={on === items.length}
                aria-label={`${group}，已选 ${on} 位，共 ${items.length} 位`}
              >
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
                    aria-pressed={selected.has(a.id)}
                  >
                    {a.name}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="roster-hint muted">{isDemoMode ? "至少选择 2 位、每轮最多 16 位。在线 Demo 使用内置演示回应，不调用外部模型。" : "至少选择 2 位、每轮最多 16 位。每位每轮都会调用一次模型；少而精往往议得更深。"}</div>
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

function ConfirmDecision({
  decisionId,
  decisionMap,
  onStartNew,
}: {
  decisionId: string;
  decisionMap: DecisionMap | null;
  onStartNew: () => void;
}) {
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

  if (saved) return (
    <div className="card decision-saved">
      <span>已存入决策日志 ✓（这是你自己的决定，可在「决策日志」里复盘）</span>
      <button className="primary" onClick={onStartNew}>开始一个新决策</button>
    </div>
  );
  return (
    <div className="card">
      <h3>现在，轮到你 · 把你的决定定下来</h3>
      <p className="muted" style={{ marginTop: -4, marginBottom: 12 }}>内阁只负责引你看清，决定是你的。写下你此刻的抉择。</p>
      <div className="form-field">
        <label htmlFor="decision-chosen">我的决定</label>
        <input id="decision-chosen" value={chosen} onChange={(e) => setChosen(e.target.value)} placeholder="例如：先用一个可逆试验验证需求，再决定是否全面投入" />
      </div>
      <div className="form-field">
        <label htmlFor="decision-rationale">我这样定的理由</label>
        <textarea id="decision-rationale" value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="是什么让你落到这个决定" />
      </div>
      <div className="form-field">
        <label htmlFor="decision-expectation">预期、待验证证据与停止条件</label>
        <textarea id="decision-expectation" value={expectation} onChange={(e) => setExpectation(e.target.value)} placeholder="什么证据说明方向正确？什么条件出现时停止、退出或回滚？" />
      </div>
      <div className="form-field">
        <label htmlFor="decision-tags">标签（逗号分隔）</label>
        <input id="decision-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="市场进入, 可逆试验" />
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
