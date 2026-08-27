import type {
  AdvisorPublic,
  Decision,
  DecisionMap,
  DialogueEntry,
  FactSheet,
  KnowledgeCard,
  OrgMemory,
  Participation,
  ProductConfig,
  RoundAgenda,
  RoundSummary,
} from "./api";

export const isDemoMode = import.meta.env.MODE === "demo";

interface DemoPayload {
  config: ProductConfig;
  advisors: AdvisorPublic[];
  knowledge: KnowledgeCard[];
  knowledge_stats: Record<string, number>;
}

const DECISIONS_KEY = "decision-cabinet-demo-decisions-v1";
const ORG_KEY = "decision-cabinet-demo-org-v1";
const encoder = new TextEncoder();

let installed = false;
let payload: DemoPayload | null = null;

export async function installDemoApi(): Promise<void> {
  if (!isDemoMode || installed) return;
  // v0.3 stored demo-only drafts in origin-wide localStorage. GitHub Pages
  // projects share an origin, so remove those legacy keys and keep v0.4 data
  // in this tab's sessionStorage instead.
  window.localStorage.removeItem(DECISIONS_KEY);
  window.localStorage.removeItem(ORG_KEY);
  const nativeFetch = window.fetch.bind(window);
  const dataResponse = await nativeFetch(`${import.meta.env.BASE_URL}demo-data.json`);
  if (!dataResponse.ok) throw new Error("在线 Demo 数据加载失败，请刷新后重试。");
  payload = await dataResponse.json() as DemoPayload;
  installed = true;

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const requestUrl = input instanceof Request ? input.url : String(input);
    const url = new URL(requestUrl, window.location.origin);
    if (!url.pathname.startsWith("/api/")) return nativeFetch(input, init);
    return handleDemoRequest(url, input, init);
  };
}

export function clearDemoSessionData(): void {
  window.sessionStorage.removeItem(DECISIONS_KEY);
  window.sessionStorage.removeItem(ORG_KEY);
  window.localStorage.removeItem(DECISIONS_KEY);
  window.localStorage.removeItem(ORG_KEY);
}

async function handleDemoRequest(url: URL, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (!payload) return json({ detail: { message: "Demo 尚未初始化。" } }, 503);
  const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
  const signal = init?.signal || (input instanceof Request ? input.signal : undefined);
  const body = await parseBody(input, init);
  const path = url.pathname;

  if (method === "GET" && path === "/api/product/config") return json(payload.config);
  if (method === "GET" && path === "/api/advisors") return json({ advisors: payload.advisors });
  if (method === "GET" && path.startsWith("/api/advisors/")) {
    const advisor = payload.advisors.find((item) => item.id === path.split("/").at(-1));
    return advisor ? json(advisor) : json({ detail: { message: "没有找到这位顾问。" } }, 404);
  }
  if (method === "GET" && path === "/api/knowledge") return knowledgeResponse(url);
  if (method === "POST" && path === "/api/council/clarify") return json({ questions: clarify(String(body.question || ""), Boolean(body.include_memory)) });
  if (method === "POST" && path === "/api/council/factsheet") return json(buildFactSheet(String(body.question || "")));
  if (method === "POST" && path === "/api/decision/map") return json(buildDecisionMap(String(body.question || ""), Boolean(body.include_memory)));
  if (method === "POST" && path === "/api/council/round") return councilRound(body, signal);
  if (method === "POST" && path === "/api/council/close") return councilClose(body, signal);
  if (method === "POST" && /\/api\/advisors\/[^/]+\/chat$/.test(path)) return advisorChat(path, body);
  if (method === "GET" && path === "/api/decisions") return listDecisions(url);
  if (method === "PATCH" && path.startsWith("/api/decisions/")) return patchDecision(path, body);
  if (method === "POST" && /\/api\/decisions\/[^/]+\/review$/.test(path)) return reviewDecision(path, body);
  if (method === "GET" && path === "/api/org-memory") return json(readOrg());
  if (method === "PUT" && path === "/api/org-memory") return saveOrg(body);

  return json({ detail: { message: "在线 Demo 未实现这个接口。请在本地运行完整开源版。" } }, 404);
}

function knowledgeResponse(url: URL): Response {
  const domain = url.searchParams.get("domain") || "";
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const cards = payload!.knowledge.filter((card) => {
    if (domain && card.domain !== domain) return false;
    if (!q) return true;
    return [card.title, card.summary, ...card.tags, ...card.questions]
      .join(" ").toLowerCase().includes(q);
  });
  return json({ cards, stats: payload!.knowledge_stats });
}

function clarify(question: string, includeMemory = false) {
  const investment = isInvestment(question);
  const questions = [
    { q: "这次决策真正想得到、守住或避免什么？", why: "先把目标和恐惧分开。" },
    { q: investment ? "这笔资金的期限、最大可承受损失和流动性要求是什么？" : "预算、期限和不能越过的底线是什么？", why: "承载力决定可选动作。" },
    { q: "目前有哪些已核实事实，哪些只是你的判断？", why: "把事实与叙事分开。" },
    { q: "什么新证据出现时，你愿意改变决定？", why: "提前写下反证，减少事后合理化。" },
  ];
  const memory = includeMemory ? memoryContext() : "";
  if (memory) questions.push({ q: `结合你的本地决策档案（${memory}），这次选择最不能牺牲什么？`, why: "让单次选择与长期方向和现实边界对齐。" });
  return questions;
}

function buildFactSheet(question: string): FactSheet {
  return {
    facts: [`用户正在讨论：${question || "一个尚未描述的决策"}`],
    assumptions: ["当前方案能产生预期价值", "现实承载力足以覆盖时间、现金与注意力成本"],
    unknowns: ["关键数据、替代方案与受影响者反馈尚未完整提供"],
    evidence_gaps: ["原始数据或披露", "最小可逆试验结果", "明确的停止条件"],
  };
}

function buildDecisionMap(question: string, includeMemory = false): DecisionMap {
  const q = question.trim() || "这个决定应该如何推进？";
  const investment = isInvestment(q);
  const life = !investment && /人生|职业|工作|城市|关系|结婚|离职|转行|搬家|选择/.test(q);
  const decisionType = investment ? "investment" : life ? "life" : "business";
  const options = investment ? investmentOptions() : generalOptions();
  const org = includeMemory ? readOrg() : null;
  const localConstraints = org && Array.isArray(org.constraints) ? org.constraints.slice(0, 3) : [];
  const officialSources = investment ? [
    "https://www.investor.gov/introduction-investing",
    "https://www.sec.gov/edgar/search/",
    "https://www.cninfo.com.cn/new/index",
  ] : [
    "https://www.oecd.org/en/publications/oecd-glossary-of-statistical-terms_9789264055087-en.html",
  ];

  return {
    decision_type: decisionType,
    core_question: q,
    objective: org?.mission
      ? `在不偏离长期方向“${short(org.mission)}”的前提下，用可承受的代价验证最关键的不确定性。`
      : investment
        ? "在不伤害生活与经营安全的前提下，提高长期风险调整后回报。"
        : "用可承受的代价验证最关键的不确定性，同时保留未来选择权。",
    constraints: investment
      ? ["资金期限与流动性需求", "最大可承受损失", "组合集中度", "原始披露质量", ...localConstraints]
      : ["现金、时间与注意力预算", "团队或关系承载力", "不可逆承诺", "复盘期限", ...localConstraints],
    stakeholders: investment ? ["决策者", "家庭或业务现金流", "其他资产配置目标"] : ["决策者", "客户或受影响者", "团队与关键关系人"],
    options,
    tensions: investment
      ? ["潜在收益与本金安全", "快速行动与证据充分", "集中押注与保留选择权"]
      : ["速度与稳健", "投入承诺与保持可逆", "短期结果与长期能力建设"],
    yin_yang_cycles: [
      "扩张带来规模，也消耗现金、注意力与组织承载力；当复杂度增长快于价值时，优势会转成负担。",
      "控制能降低短期偏差，也可能削弱反馈；信息更清楚后，应从控制逐步转向授权或退出。",
      investment
        ? "上涨会强化信心并诱发加仓，下跌会放大恐惧并诱发低位退出；预先写下仓位与反证可减弱情绪反馈。"
        : "早期正反馈会推动加码，但样本不足时也可能制造虚假确定感；阶段门能阻止试验变成无上限承诺。",
    ],
    evolution_paths: [
      { name: "基准", trigger: "现有条件大体延续", near_term: "按当前节奏推进并获得有限反馈", medium_term: "真实成本与价值逐步显现", leading_signals: ["关键指标按预期变化", "现金和时间消耗可控"], response: "按预设复盘节奏调整，不提前锁死。" },
      { name: "上行", trigger: "关键假设被高质量证据验证", near_term: "效果或需求超过基准", medium_term: "机会扩大，同时复杂度上升", leading_signals: ["重复购买或持续使用", "现金流、留存或核心指标改善"], response: "分阶段加码，每次增加承诺前重新检查风险预算。" },
      { name: "下行", trigger: "关键假设被证伪或外部约束恶化", near_term: "进展低于阈值，成本上升", medium_term: "损失与机会成本继续扩大", leading_signals: ["领先指标连续偏离", "证据质量下降", "流动性或承载力恶化"], response: "触发停止、退出或回滚，保留现金与选择权。" },
    ],
    evidence_to_collect: investment
      ? ["最新法定披露及报告期", "经营现金流、负债与稀释风险", "当前价格隐含的增长与利润率假设", "组合仓位、资金期限与最大可承受损失"]
      : ["可验证的需求或结果数据", "单位经济与真实交付成本", "关键受影响者反馈", "最小可逆试验的成功和失败阈值"],
    stop_conditions: investment
      ? ["核心投资论点被原始披露证伪", "仓位或组合回撤触及预设风险预算", "资金用途变化导致无法继续承受"]
      : ["达到预设预算或期限仍未验证关键假设", "真实成本持续高于价值", "触及法律、伦理、现金流或关系底线"],
    knowledge_ids: investment
      ? ["investment-evidence", "financial-statements", "valuation-margin-of-safety", "portfolio-risk", "market-cycle"]
      : ["choice-and-cost", "scenario-evolution", "experiment-feedback", "yin-yang-cycle", "decision-quality"],
    confidence_note: "这是浏览器内置的结构化演示，不是针对具体公司的实时研究，也不构成建议。请用原始资料核验事实。",
    data_as_of: investment ? "在线演示未连接实时行情或财报" : "在线演示使用通用决策框架",
    source_urls: officialSources,
    facts: [],
    inferences: [
      "用户尚未提供足以核验的原始数据",
      "当前选项和情景用于展开讨论，不代表预测",
      ...(includeMemory && memoryContext() ? [`已按本轮授权纳入浏览器本地档案：${memoryContext()}`] : []),
    ],
  };
}

function investmentOptions() {
  return [
    { name: "暂不行动，先完成原始证据核验", gains: ["保留本金与选择权", "减少叙事驱动的错误"], direct_costs: ["投入研究时间"], opportunity_costs: ["可能错过一段价格波动"], risks: ["研究可能变成无限拖延"], second_order_effects: ["建立更稳定的投资纪律"], reversibility: "高度可逆；设置重新决策日期。" },
    { name: "用小仓位做可逆验证", gains: ["获得真实持仓反馈", "控制单次判断错误的损失"], direct_costs: ["承担小额波动和交易成本"], opportunity_costs: ["判断正确时收益低于重仓"], risks: ["短期盈利可能诱发过度自信"], second_order_effects: ["实际体验会暴露心理承受力和研究缺口"], reversibility: "较高；仓位和流动性必须预先限定。" },
    { name: "分阶段建仓，每阶段重新核验", gains: ["把证据更新纳入行动", "避免一次性锁死"], direct_costs: ["需要持续跟踪和执行纪律"], opportunity_costs: ["上涨时平均成本可能提高"], risks: ["没有明确门槛时会机械加仓"], second_order_effects: ["让仓位随证据质量而不是情绪变化"], reversibility: "中等；每阶段都要有暂停和退出条件。" },
  ];
}

function generalOptions() {
  return [
    { name: "先做最小可逆试验", gains: ["用较低代价验证最昂贵的不确定性"], direct_costs: ["需要设计试验、预算与期限"], opportunity_costs: ["可能错过部分窗口"], risks: ["样本失真，或把试验误当成确认"], second_order_effects: ["证据更清楚后，后续行动会更快"], reversibility: "高度可逆；预先规定验证期限。" },
    { name: "分阶段推进当前方案", gains: ["保持动量，同时控制承诺"], direct_costs: ["投入部分现金、时间与注意力"], opportunity_costs: ["资源不能同时投向其他机会"], risks: ["阶段门模糊会导致不断加码"], second_order_effects: ["形成可复盘的组织反馈循环"], reversibility: "中等；以阶段预算和复盘节点控制。" },
    { name: "暂不行动，保留选择权", gains: ["保留现金、时间和调整空间"], direct_costs: ["继续承担现状成本与监测成本"], opportunity_costs: ["可能错过窗口或较优位置"], risks: ["等待可能被误当成没有代价"], second_order_effects: ["外部变化可能扩大，也可能收窄选择集"], reversibility: "短期可逆；必须设置重新决策日期。" },
  ];
}

function councilRound(body: Record<string, unknown>, signal?: AbortSignal): Response {
  const question = String(body.question || "这个决定");
  const round = Math.max(1, Math.min(4, Number(body.round_index || 1)));
  const requested = Array.isArray(body.advisor_ids) ? body.advisor_ids.map(String) : [];
  const transcript = Array.isArray(body.transcript) ? body.transcript.filter(isRecord) : [];
  const summaries = Array.isArray(body.summaries) ? body.summaries.filter(isRoundSummary) : [];
  const participation = isRecord(body.participation)
    ? {
      mode: String(body.participation.mode || "listen"),
      content: String(body.participation.content || ""),
      reply_to_id: String(body.participation.reply_to_id || ""),
      reply_to_name: String(body.participation.reply_to_name || ""),
      reply_excerpt: String(body.participation.reply_excerpt || ""),
    } as Participation
    : { mode: "listen", content: "" } as Participation;
  const agenda = demoAgenda(round, summaries, participation);
  const selected = (requested.length ? requested : payload!.advisors.slice(0, 8).map((item) => item.id)).slice(0, 16);
  const shift = (round - 1) % Math.max(selected.length, 1);
  const ids = [...selected.slice(shift), ...selected.slice(0, shift)];
  agenda.opening_speaker_id = ids[0] || "";
  const working = [...transcript];
  const turns: DialogueEntry[] = [];
  const founderTarget = participation.mode === "listen" ? undefined : [...transcript].reverse().find((item) => (
    item.role === "founder"
    && String(item.participation_mode || "") !== "listen"
    && String(item.content || "").trim()
  ));
  ids.forEach((id, index) => {
    const target = index === 0 && founderTarget
      ? founderTarget
      : [...working].reverse().find((item) => item.role === "advisor" && item.speaker_id !== id);
    const turn = buildTurn(id, question, round, participation, target, index, Boolean(body.include_memory));
    turns.push(turn);
    working.push(turn as unknown as Record<string, unknown>);
  });
  const summary = demoSummary(round, agenda, turns, participation, founderTarget);
  const events = [event("agenda", agenda), ...turns.map((turn) => event("turn", turn)), event("round_summary", summary)];
  events.push(event("done", { round, turns, summary, next_action: round === 4 ? "close" : "participate_or_listen" }));
  return sseSequence(events, signal);
}

export function demoAgenda(round: number, summaries: RoundSummary[], participation: Participation): RoundAgenda {
  const last = summaries.at(-1);
  const phases: Record<number, Pick<RoundAgenda, "phase" | "title" | "objective">> = {
    1: { phase: "facts", title: "事实定界与初步立场", objective: "把事实与推断分开，形成小结论、共识和非共识。" },
    2: { phase: "debate", title: "聚焦争议与观点交锋", objective: "围绕上一轮未解决的分歧，让支持与反对意见直接回应。" },
    3: { phase: "stress_test", title: "代价、反证与局势演化", objective: "检验最坏情景、二阶效应和改变立场的信号。" },
    4: { phase: "convergence", title: "条件式收束与少数意见", objective: "说明什么条件下选什么，同时保留少数意见和停止条件。" },
  };
  const previousDissents = last?.dissents.slice(0, 2) || [];
  const topics = round === 1
    ? ["区分已核实事实、推断与未知", "各方给出初步立场", "形成小结论、共识与非共识"]
    : round === 2
      ? (previousDissents.length > 0
        ? previousDissents.map((item) => `争议：${item}`)
        : ["争议：现在行动还是先验证", "争议：机会窗口是否足以覆盖承载代价"])
      : round === 3
        ? ["最坏情景与不可逆代价", "二阶效应与阴阳反转", "什么证据会让各方改变立场"]
        : ["条件式建议与少数意见", "下一步证据和行动", "停止、退出与复盘条件"];
  if (participation.mode === "focus" && participation.content) topics.unshift(`用户指定争议：${short(participation.content)}`);
  if (participation.mode === "answer" && participation.content) topics.unshift(`核对用户回答：${short(participation.content)}`);
  if (participation.mode === "add" && participation.content) topics.unshift(`检验用户补充：${short(participation.content)}`);
  return { round, ...phases[round], topics: topics.slice(0, 5), opening_speaker_id: "" };
}

function buildTurn(
  id: string,
  question: string,
  round: number,
  participation: Participation,
  target: Record<string, unknown> | undefined,
  index: number,
  includeMemory = false,
): DialogueEntry {
  const advisor = payload!.advisors.find((item) => item.id === id) || payload!.advisors[0];
  const replyName = target ? String(target.speaker_name || "") : "";
  const replyRole = target ? String(target.role || "advisor") : "";
  const replyExcerpt = target ? short(String(target.content || "")) : "";
  const stanceCycles = round === 2 ? ["challenge", "refine", "support"] : ["refine", "challenge", "support"];
  const stance = replyName ? stanceCycles[index % stanceCycles.length] as DialogueEntry["stance"] : "propose";
  const content = advisorMessage(id, question, round, participation, replyName, stance, includeMemory, replyRole);
  const delta = advisorDelta(id, round);
  const firstCanon = advisor.canon[0];
  return {
    round,
    role: "advisor",
    speaker_id: advisor.id,
    speaker_name: advisor.name,
    lineage: advisor.lineage,
    content,
    citations: firstCanon ? [{ kind: "method", code: advisor.id, title: firstCanon.title, path: firstCanon.path }] : [],
    provider: "browser-demo",
    model: null,
    entry_id: makeId("turn"),
    reply_to_id: target ? String(target.entry_id || "") : "",
    reply_to_name: replyName,
    reply_excerpt: replyExcerpt,
    stance,
    novelty: round === 1 ? "new" : "refined",
    participation_mode: "",
    delta_type: delta.type,
    delta: delta.text,
  };
}

function advisorMessage(
  id: string,
  question: string,
  round: number,
  participation: Participation = { mode: "listen", content: "" },
  replyName = "",
  stance: DialogueEntry["stance"] = "propose",
  includeMemory = false,
  replyRole = "",
): string {
  const stanceVerb = stance === "challenge" ? "要质疑" : stance === "support" ? "支持并推进" : "想补充修正";
  const relation = replyRole === "founder"
    ? "我先直接回应你的观点："
    : replyName
      ? `我${stanceVerb}${replyName}的判断：`
    : "我先把自己的判断摆出来。";
  const memory = includeMemory ? memoryContext() : "";
  const memorySuffix = memory ? ` 同时要守住你本地档案里的边界：${memory}。` : "";
  const lenses: Record<string, string> = {
    analyst: "把已核实事实、推断和未知分开，不能拿叙事冒充证据",
    "investment-analyst": "把标的放回整个组合，并写清数据时点、仓位上限与论点失效条件",
    munger: "反过来找会造成永久损失、且难以恢复的失败路径",
    drucker: "先定义四周后能在客户或结果端看到的外部成果",
    laozi: "观察投入和控制在哪个阈值后会反过来损伤承载力",
    huineng: "放下必须证明自己正确的执著，检查是否在选择性寻找证据",
    jung: "说出藏在理性分析背后的恐惧、投射与身份需求",
    inamori: "检验动机是否经得起客户、团队和长期信任的考验",
  };
  const lens = lenses[id] || `从${payload!.advisors.find((item) => item.id === id)?.core_insight || "这个方法视角"}检查所得、代价与停止条件`;
  const phaseMessage = {
    1: `${relation} 关于“${short(question)}”，我先主张${lens}。眼下最小的可推进结论，是先承认哪些信息还没有被核实。`,
    2: `${relation}分歧不在“要不要认真”，而在证据不足时该承担多大承诺。我的立场是${lens}；请下一位说明，什么事实足以证明现在就该加码。`,
    3: `${relation}现在不再重复方向，我只做压力测试：假设判断错了，${lens}。请把会提前出现的失败信号和可回滚动作写出来。`,
    4: `${relation}我的最终意见是条件式的：只有关键证据达到门槛才推进，同时要${lens}。若触发停止条件，我支持退出；这项少数意见应保留。`,
  }[round];
  return phaseMessage + memorySuffix;
}

function advisorDelta(id: string, round: number): { type: NonNullable<DialogueEntry["delta_type"]>; text: string } {
  const additions: Record<string, string> = {
    analyst: "把事实、推断和未知分别编号，下一轮只争论仍会改变选择的未知。",
    "investment-analyst": "增加仓位上限、数据时点和论点失效条件三项可核验门槛。",
    munger: "新增一条永久损失路径，并要求先证明它可被预算上限截断。",
    drucker: "把抽象目标改写为四周内能在客户或结果端观察到的外部成果。",
    laozi: "新增承载阈值：投入越过阈值后，原本的优势会反转成负担。",
    huineng: "新增反证检查：是否只接受能证明自己原先正确的信息。",
    jung: "把身份需要和现实目标拆开，防止用理性语言包装恐惧。",
    inamori: "新增长期信任条件：即使短期有效，也不能把代价转嫁给客户或团队。",
  };
  const typeByRound: Record<number, NonNullable<DialogueEntry["delta_type"]>> = {
    1: "new_evidence", 2: "counterexample", 3: "condition", 4: "position_change",
  };
  const base = additions[id] || "新增一个可核验条件，并说明它会如何改变当前选择。";
  const roundText: Record<number, string> = {
    1: `初步主张：${base}`,
    2: `交锋推进：${base} 这会改变“现在行动还是继续验证”的判断。`,
    3: `压力测试：把“${short(base)}”改写成可观察阈值，未达到就不继续加码。`,
    4: `条件式结论：只有“${short(base)}”得到验证才推进，否则保留选择权并执行停止条件。`,
  };
  return {
    type: typeByRound[round] || "evidence_request",
    text: roundText[round] || base,
  };
}

function demoSummary(
  round: number,
  agenda: RoundAgenda,
  turns: DialogueEntry[],
  participation: Participation,
  founder?: Record<string, unknown>,
): RoundSummary {
  const positions = [
    ...(founder ? [{
      speaker_id: "founder",
      speaker_name: "我的观点",
      claim: short(String(founder.content || "")),
      stance: "propose",
      responds_to_name: String(founder.reply_to_name || ""),
      responds_to_id: String(founder.reply_to_id || ""),
      role: "founder" as const,
    }] : []),
    ...turns.map((turn) => ({
      speaker_id: turn.speaker_id,
      speaker_name: turn.speaker_name,
      claim: short(turn.content),
      stance: turn.stance,
      responds_to_name: turn.reply_to_name,
      responds_to_id: turn.reply_to_id,
      role: "advisor" as const,
    })),
  ];
  const names = turns.map((turn) => turn.speaker_name);
  const namedDissents = turns
    .filter((turn) => turn.stance === "challenge")
    .slice(0, 2)
    .map((turn) => `${turn.speaker_name}提出质疑：${short(turn.delta || turn.content)}`);
  const namedAlternatives = turns
    .filter((turn) => turn.stance === "support" || turn.stance === "refine")
    .slice(0, 2)
    .map((turn) => `${turn.speaker_name}${turn.stance === "support" ? "支持推进" : "补充修正"}：${short(turn.delta || turn.content)}`);
  const participationNote = participation.mode === "listen" || !participation.content
    ? "本轮用户选择旁听，委员会必须依靠既有分歧继续推进。"
    : `委员会已把用户的${({ answer: "回答", add: "补充", focus: "指定争议" } as Record<string, string>)[participation.mode] || "发言"}“${short(participation.content)}”纳入议题。`;
  const turnConclusions = turns.slice(0, 3).map((turn) => `${turn.speaker_name}：${short(turn.delta || turn.content)}`);
  const allContent = {
    1: {
      conclusions: turnConclusions,
      consensus: [`${names.join("、")}都同意先区分事实、推断与未知。`, "任何推进都应写下证据门槛与停止条件。"],
      dissents: [...namedDissents, ...namedAlternatives],
      questions: ["在这些初步判断里，哪一条忽略了你的真实处境？"],
      next: ["把“现在行动还是先验证”收窄为可直接交锋的议题。"],
    },
    2: {
      conclusions: [participationNote, ...turnConclusions.slice(0, 2)],
      consensus: [`${names.join("、")}都承认等待有机会成本、行动有承载代价，两者都要显性化。`],
      dissents: [...namedDissents, ...namedAlternatives],
      questions: ["你最愿意承担哪一种代价，又绝不能承担哪一种？"],
      next: ["用最坏情景、二阶效应和反证压力测试这两组立场。"],
    },
    3: {
      conclusions: [participationNote, ...turnConclusions.slice(0, 2)],
      consensus: [`${names.join("、")}都要求预先写下失败信号、复盘日期和可回滚动作。`],
      dissents: [...namedDissents, ...namedAlternatives],
      questions: ["什么证据一出现，你会改变现在的倾向或立即停下？"],
      next: ["形成条件式建议，并把少数意见与停止条件留在最终纪要里。"],
    },
    4: {
      conclusions: [participationNote, ...turnConclusions.slice(0, 2)],
      consensus: [`${names.join("、")}都同意最终结论必须带适用条件与停止条件。`, "最终决定属于用户，委员会只提供条件与边界。"],
      dissents: [...namedDissents, ...namedAlternatives],
      questions: ["你最终选择什么，并愿意亲自承担哪一项代价？"],
      next: ["记录选择、证据、停止条件和复盘时间。"],
    },
  };
  const content = allContent[round as keyof typeof allContent] || allContent[1];
  const dissents = content.dissents.length > 0
    ? content.dissents
    : [turns.length < 2 ? "只有一个顾问视角，无法形成真正的观点交锋。" : "本轮暂未形成明确反对意见，下一轮需主动指定反方压力测试。"];
  return {
    round,
    phase: agenda.phase,
    title: agenda.title,
    topics: agenda.topics,
    positions,
    provisional_conclusions: content.conclusions,
    consensus: content.consensus,
    dissents,
    questions_for_user: content.questions,
    next_round_focus: content.next,
    created_at_utc: now(),
  };
}

function councilClose(body: Record<string, unknown>, signal?: AbortSignal): Response {
  const question = String(body.question || "这个决定");
  const map = (body.decision_map || buildDecisionMap(question)) as DecisionMap;
  const text = "这场讨论真正留下的，不是一个标准答案，而是一个张力：你既想抓住机会，也想保留不被一次判断锁死的空间。现在请你只回答三件事：最想守住什么，愿意付出什么代价，什么证据出现时会停下或改变。把这三件事写清，决定就应该由你亲自做。";
  const decision = newDecision(question, map, text);
  const transcript = Array.isArray(body.transcript) ? body.transcript.filter(isRecord) : [];
  const finalRound = Math.max(1, ...transcript.map((item) => Number(item.round || 0)));
  const close: DialogueEntry = {
    round: finalRound, role: "facilitator", speaker_id: "facilitator",
    speaker_name: "主持人", lineage: "决策内阁", content: text, citations: [],
    provider: "browser-demo", model: null,
    entry_id: makeId("close"), reply_to_id: "", reply_to_name: "", reply_excerpt: "",
    stance: "synthesize", novelty: "refined", participation_mode: "",
  };
  const splitAt = Math.ceil(text.length / 3);
  const tokens = [text.slice(0, splitAt), text.slice(splitAt, splitAt * 2), text.slice(splitAt * 2)]
    .filter(Boolean)
    .map((chunk) => event("token", chunk));
  return sseSequence(
    [...tokens, event("done", { close, decision_id: decision.id })],
    signal,
    90,
    (index) => {
      if (index === tokens.length) {
        writeDecisions([decision, ...readDecisions().filter((item) => item.id !== decision.id)]);
      }
    },
  );
}

function advisorChat(path: string, body: Record<string, unknown>): Response {
  const id = path.split("/").at(-2) || "analyst";
  const question = String(body.question || "这个决定");
  const advisor = payload!.advisors.find((item) => item.id === id) || payload!.advisors[0];
  return json({
    session_id: String(body.session_id || makeId("chat")), advisor_id: advisor.id,
    answer: advisorMessage(
      advisor.id,
      question,
      body.session_id ? 2 : 1,
      { mode: "listen", content: "" },
      "",
      "propose",
      Boolean(body.include_memory),
    ),
    provider: "browser-demo", model: null,
    citations: advisor.canon[0] ? [{ kind: "method", code: advisor.id, title: advisor.canon[0].title, path: advisor.canon[0].path }] : [],
  });
}

function listDecisions(url: URL): Response {
  const status = url.searchParams.get("status");
  const tag = url.searchParams.get("tag");
  const decisions = readDecisions().filter((item) => (!status || item.status === status) && (!tag || item.tags.includes(tag)));
  return json({ decisions });
}

function patchDecision(path: string, body: Record<string, unknown>): Response {
  const id = path.split("/").at(-1);
  const decisions = readDecisions();
  const index = decisions.findIndex((item) => item.id === id);
  if (index < 0) return json({ detail: { message: "没有找到这条决策。" } }, 404);
  decisions[index] = { ...decisions[index], ...body, id: decisions[index].id, updated_at_utc: now() } as Decision;
  writeDecisions(decisions);
  return json(decisions[index]);
}

function reviewDecision(path: string, body: Record<string, unknown>): Response {
  const id = path.split("/").at(-2);
  const decisions = readDecisions();
  const index = decisions.findIndex((item) => item.id === id);
  if (index < 0) return json({ detail: { message: "没有找到这条决策。" } }, 404);
  decisions[index] = {
    ...decisions[index], status: "reviewed", review_outcome: String(body.review_outcome || ""),
    reviewed_at_utc: now(), updated_at_utc: now(),
  };
  writeDecisions(decisions);
  return json(decisions[index]);
}

function newDecision(question: string, map: DecisionMap, rationale: string): Decision {
  const timestamp = now();
  return {
    id: makeId("decision"), title: question, context: question, council_session_id: null,
    options_considered: map.options.map((item) => item.name), chosen: "", rationale,
    expectation: `目标：${map.objective}\n待验证证据：${map.evidence_to_collect.join("；")}\n停止/退出条件：${map.stop_conditions.join("；")}`,
    tags: [], status: "draft", review_outcome: null, reviewed_at_utc: null,
    created_at_utc: timestamp, updated_at_utc: timestamp, decision_map: map,
  };
}

function readOrg(): OrgMemory {
  const fallback: OrgMemory = {
    mission: "", values: [], audience: [], product_lines: [], constraints: [],
    voice_and_taste: "", updated_at_utc: now(),
  };
  return readLocal(ORG_KEY, fallback);
}

function memoryContext(): string {
  const org = readOrg();
  const parts = [
    org.mission ? `长期方向：${short(org.mission)}` : "",
    Array.isArray(org.constraints) && org.constraints.length ? `现实约束：${org.constraints.slice(0, 3).join("、")}` : "",
    Array.isArray(org.values) && org.values.length ? `价值观：${org.values.slice(0, 3).join("、")}` : "",
  ].filter(Boolean);
  return parts.join("；");
}

function saveOrg(body: Record<string, unknown>): Response {
  const org = { ...readOrg(), ...body, updated_at_utc: now() } as OrgMemory;
  sessionStorage.setItem(ORG_KEY, JSON.stringify(org));
  return json(org);
}

function readDecisions(): Decision[] {
  return readLocal<Decision[]>(DECISIONS_KEY, []);
}

function writeDecisions(decisions: Decision[]) {
  sessionStorage.setItem(DECISIONS_KEY, JSON.stringify(decisions.slice(0, 100)));
}

function readLocal<T>(key: string, fallback: T): T {
  try {
    const value = sessionStorage.getItem(key);
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

async function parseBody(input: RequestInfo | URL, init?: RequestInit): Promise<Record<string, unknown>> {
  try {
    if (typeof init?.body === "string") return JSON.parse(init.body) as Record<string, unknown>;
    if (input instanceof Request) return await input.clone().json() as Record<string, unknown>;
  } catch {
    return {};
  }
  return {};
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function sseSequence(
  values: string[],
  signal?: AbortSignal,
  delayMs = 140,
  beforeEnqueue?: (index: number) => void,
): Response {
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (signal?.aborted) {
        controller.error(new DOMException("请求已取消", "AbortError"));
        return;
      }
      if (index > 0) {
        try {
          await abortableDelay(delayMs, signal);
        } catch (error) {
          controller.error(error);
          return;
        }
      }
      if (signal?.aborted) {
        controller.error(new DOMException("请求已取消", "AbortError"));
        return;
      }
      const value = values[index];
      if (value === undefined) {
        controller.close();
        return;
      }
      beforeEnqueue?.(index);
      controller.enqueue(encoder.encode(value));
      index += 1;
      if (index >= values.length) controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException("请求已取消", "AbortError"));
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new DOMException("请求已取消", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function event(name: string, value: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(value)}\n\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isRoundSummary(value: unknown): value is RoundSummary {
  return isRecord(value) && typeof value.round === "number" && Array.isArray(value.dissents);
}

function isInvestment(question: string): boolean {
  return /股票|基金|投资|买入|卖出|持仓|仓位|估值|收益率|证券|stock|equity|portfolio|valuation|invest/i.test(question);
}

function short(text: string): string {
  return text.length > 48 ? `${text.slice(0, 48)}…` : text;
}

function now(): string {
  return new Date().toISOString();
}

function makeId(prefix: string): string {
  const suffix = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${suffix}`;
}
