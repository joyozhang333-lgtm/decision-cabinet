import type {
  AdvisorPublic,
  Decision,
  DecisionMap,
  DialogueEntry,
  FactSheet,
  KnowledgeCard,
  OrgMemory,
  ProductConfig,
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

async function handleDemoRequest(url: URL, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (!payload) return json({ detail: { message: "Demo 尚未初始化。" } }, 503);
  const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
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
  if (method === "POST" && path === "/api/council/round") return councilRound(body);
  if (method === "POST" && path === "/api/council/close") return councilClose(body);
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

function councilRound(body: Record<string, unknown>): Response {
  const question = String(body.question || "这个决定");
  const round = Number(body.round_index || 1);
  const requested = Array.isArray(body.advisor_ids) ? body.advisor_ids.map(String) : [];
  const transcript = Array.isArray(body.transcript) ? body.transcript : [];
  const founderFollowup = [...transcript].reverse().find((item) => (
    item && typeof item === "object" && (item as Record<string, unknown>).role === "founder"
  ));
  const followup = founderFollowup && typeof founderFollowup === "object"
    ? String((founderFollowup as Record<string, unknown>).content || "")
    : "";
  const ids = (requested.length ? requested : payload!.advisors.slice(0, 8).map((item) => item.id)).slice(0, 16);
  const turns = ids.map((id) => buildTurn(id, question, round, followup, Boolean(body.include_memory)));
  const events = turns.map((turn) => event("turn", turn));
  events.push(event("done", { round, turns }));
  return sse(events.join(""));
}

function buildTurn(id: string, question: string, round: number, followup = "", includeMemory = false): DialogueEntry {
  const advisor = payload!.advisors.find((item) => item.id === id) || payload!.advisors[0];
  const content = advisorMessage(id, question, round, followup, includeMemory);
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
  };
}

function advisorMessage(id: string, question: string, round: number, followup = "", includeMemory = false): string {
  const prefix = followup
    ? `你刚才补充了“${short(followup)}”。我顺着这一点再往下追一层。`
    : round > 1
      ? "顺着前一轮的张力，我再往下追一层。"
      : "先别急着选。";
  const memory = includeMemory ? memoryContext() : "";
  const memorySuffix = memory ? ` 同时要守住你本地档案里的边界：${memory}。` : "";
  const messages: Record<string, string> = {
    analyst: `${prefix} 关于“${short(question)}”，请先列出三栏：已核实事实、推断、还不知道。最危险的不是不知道，而是把推断当事实。`,
    "investment-analyst": `${prefix} 如果这是投资问题，先把标的放回整个组合。写清数据时点、原始披露、仓位上限和论点失效条件，再谈收益。`,
    munger: `${prefix} 反过来想：什么情形会让这个决定失败，而且失败后很难恢复？先避开毁灭性结果，再讨论上行空间。`,
    drucker: `${prefix} 这个动作要产生的外部成果是什么？如果四周后只有更多活动、没有可验证成果，就不算进展。`,
    laozi: `${prefix} 继续增加控制和投入，在哪个点会反过来损伤承载力？知止不是退缩，是不让局面被自己的力量压坏。`,
    huineng: `${prefix} 看看你是否已经执著于某个答案，再去选择性寻找证据。先把“我必须证明自己是对的”放下，事实会更清楚。`,
    jung: `${prefix} 你最不愿承认的恐惧是什么？它可能正以“理性分析”的样子参与决策。把阴影说出来，判断才完整。`,
    inamori: `${prefix} 这个选择的动机，除了自己的得失，是否也经得起对客户、团队和长期信任的检验？`,
  };
  return (messages[id] || `${prefix} 从${payload!.advisors.find((item) => item.id === id)?.core_insight || "这个方法视角"}来看，先写清所得、代价、反证和停止条件，再决定是否加码。`) + memorySuffix;
}

function councilClose(body: Record<string, unknown>): Response {
  const question = String(body.question || "这个决定");
  const map = (body.decision_map || buildDecisionMap(question)) as DecisionMap;
  const text = "这场讨论真正留下的，不是一个标准答案，而是一个张力：你既想抓住机会，也想保留不被一次判断锁死的空间。现在请你只回答三件事：最想守住什么，愿意付出什么代价，什么证据出现时会停下或改变。把这三件事写清，决定就应该由你亲自做。";
  const decision = newDecision(question, map, text);
  writeDecisions([decision, ...readDecisions().filter((item) => item.id !== decision.id)]);
  const close: DialogueEntry = {
    round: Number(body.round_index || 1), role: "facilitator", speaker_id: "facilitator",
    speaker_name: "主持人", lineage: "决策内阁", content: text, citations: [],
    provider: "browser-demo", model: null,
  };
  return sse(event("token", text) + event("done", { close, decision_id: decision.id }));
}

function advisorChat(path: string, body: Record<string, unknown>): Response {
  const id = path.split("/").at(-2) || "analyst";
  const question = String(body.question || "这个决定");
  const advisor = payload!.advisors.find((item) => item.id === id) || payload!.advisors[0];
  return json({
    session_id: String(body.session_id || makeId("chat")), advisor_id: advisor.id,
    answer: advisorMessage(advisor.id, question, body.session_id ? 2 : 1, "", Boolean(body.include_memory)),
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
  localStorage.setItem(ORG_KEY, JSON.stringify(org));
  return json(org);
}

function readDecisions(): Decision[] {
  return readLocal<Decision[]>(DECISIONS_KEY, []);
}

function writeDecisions(decisions: Decision[]) {
  localStorage.setItem(DECISIONS_KEY, JSON.stringify(decisions.slice(0, 100)));
}

function readLocal<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
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

function sse(value: string): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(value));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function event(name: string, value: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(value)}\n\n`;
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
