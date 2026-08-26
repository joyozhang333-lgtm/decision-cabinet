// 决策内阁前端 API 客户端。

export interface Canon { title: string; locator: string; path: string }
export interface AdvisorPublic {
  id: string; name: string; category: string; group: string; lineage: string;
  core_insight: string; lens: string[]; canon: Canon[];
}
export interface FactSheet {
  facts: string[]; assumptions: string[]; unknowns: string[]; evidence_gaps: string[];
}
export interface KnowledgeSource { label: string; url: string; source_type: string }
export interface KnowledgeCard {
  id: string; title: string; domain: string; tradition: string; tags: string[];
  summary: string; questions: string[]; method: string[]; boundaries: string[];
  sources: KnowledgeSource[]; path: string;
}
export interface OptionMap {
  name: string; gains: string[]; direct_costs: string[]; opportunity_costs: string[];
  risks: string[]; second_order_effects: string[]; reversibility: string;
}
export interface EvolutionPath {
  name: string; trigger: string; near_term: string; medium_term: string;
  leading_signals: string[]; response: string;
}
export interface DecisionMap {
  decision_type: string; core_question: string; objective: string; constraints: string[];
  stakeholders: string[]; options: OptionMap[]; tensions: string[]; yin_yang_cycles: string[];
  evolution_paths: EvolutionPath[]; evidence_to_collect: string[]; stop_conditions: string[];
  knowledge_ids: string[]; confidence_note: string;
  data_as_of: string; source_urls: string[]; facts: string[]; inferences: string[];
}
export interface ClarifyQuestion { q: string; why: string }
export interface ClarifyAnswer { q: string; a: string }
export interface Citation { kind: string; code: string; title: string; path: string }
export type DeltaType =
  | "claim"
  | "new_evidence"
  | "counterexample"
  | "condition"
  | "position_change"
  | "evidence_request"
  | "none";
export interface DialogueEntry {
  round: number; role: string; speaker_id: string; speaker_name: string;
  lineage: string; content: string; citations: Citation[]; provider: string; model: string | null;
  entry_id: string; reply_to_id: string; reply_to_name: string; reply_excerpt: string;
  stance: "propose" | "support" | "challenge" | "refine" | "abstain" | "synthesize";
  novelty: "new" | "refined" | "low"; participation_mode: ParticipationMode | "";
  delta_type?: DeltaType;
  delta?: string;
}
export type ParticipationMode = "answer" | "add" | "focus" | "listen";
export interface Participation {
  mode: ParticipationMode;
  content: string;
  reply_to_id?: string;
  reply_to_name?: string;
  reply_excerpt?: string;
}
export interface RoundAgenda {
  round: number; phase: "facts" | "debate" | "stress_test" | "convergence";
  title: string; objective: string; topics: string[]; opening_speaker_id: string;
}
export interface CouncilPosition {
  speaker_id: string; speaker_name: string; claim: string; stance: string;
  responds_to_name: string; responds_to_id: string; role: "advisor" | "founder";
}
export interface RoundSummary {
  round: number; phase: RoundAgenda["phase"]; title: string; topics: string[];
  positions: CouncilPosition[]; provisional_conclusions: string[]; consensus: string[];
  dissents: string[]; questions_for_user: string[]; next_round_focus: string[]; created_at_utc: string;
}
export interface AdvisorTurn {
  advisor_id: string; advisor_name: string; category: string; lineage: string;
  content: string; citations: Citation[]; provider: string; model: string | null;
}
export interface Synthesis {
  facts_basis: string; multi_model: string; dao_view: string;
  founder_reflection: string; decision_and_next: string;
  dissents: string[]; raw_markdown: string;
}
export interface CouncilResult {
  id: string; question: string; fact_sheet: FactSheet; advisor_ids: string[];
  turns: AdvisorTurn[]; synthesis: Synthesis; provider: string;
  created_at_utc: string; decision_id: string;
}
export interface Decision {
  id: string; title: string; context: string; council_session_id: string | null;
  options_considered: string[]; chosen: string; rationale: string; expectation: string;
  tags: string[]; status: string; review_outcome: string | null;
  reviewed_at_utc: string | null; created_at_utc: string; updated_at_utc: string;
  decision_map: DecisionMap | null;
}
export interface OrgMemory {
  mission: string; values: string[]; audience: string[];
  product_lines: string[]; constraints: string[]; voice_and_taste: string; updated_at_utc: string;
}
export interface ProviderStatus {
  default: string;
  providers: Record<string, { configured: boolean; model: string | null; [k: string]: unknown }>;
}
export interface ProductConfig {
  product: string; api_version: string; providers: ProviderStatus;
  depths: string[]; advisor_count: number; knowledge_count: number;
  knowledge_domains: Record<string, number>; philosophy: string; disclaimer: string;
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail = (body as any)?.detail;
    throw new Error(detail?.message ?? (typeof detail === "string" ? detail : res.statusText));
  }
  return res.json() as Promise<T>;
}

const UI_KEY_STORAGE = "decision-cabinet-ui-api-key";

export const getUiApiKey = () => window.localStorage.getItem(UI_KEY_STORAGE) || "";
export const setUiApiKey = (value: string) => {
  const cleaned = value.trim();
  if (cleaned) window.localStorage.setItem(UI_KEY_STORAGE, cleaned);
  else window.localStorage.removeItem(UI_KEY_STORAGE);
};
const apiHeaders = (json = false): Record<string, string> => {
  const headers: Record<string, string> = {};
  if (json) headers["Content-Type"] = "application/json";
  const key = getUiApiKey();
  if (key) headers["X-API-Key"] = key;
  return headers;
};

export const getJson = <T>(url: string) => fetch(url, { headers: apiHeaders() }).then((r) => handle<T>(r));
export const sendJson = <T>(url: string, method: string, body: unknown) =>
  fetch(url, {
    method,
    headers: apiHeaders(true),
    body: JSON.stringify(body),
  }).then((r) => handle<T>(r));

export const getConfig = () => getJson<ProductConfig>("/api/product/config");
export const listAdvisors = () => getJson<{ advisors: AdvisorPublic[] }>("/api/advisors");

export const requestFactsheet = (question: string, depth: string, provider?: string, includeMemory = false) =>
  sendJson<FactSheet>("/api/council/factsheet", "POST", { question, depth, provider, include_memory: includeMemory });

export const requestClarify = (question: string, depth: string, provider?: string, includeMemory = false) =>
  sendJson<{ questions: ClarifyQuestion[] }>("/api/council/clarify", "POST", { question, depth, provider, include_memory: includeMemory });

export const requestDecisionMap = (
  question: string, depth: string, provider?: string, background?: string, includeMemory = false,
) => sendJson<DecisionMap>("/api/decision/map", "POST", { question, depth, provider, background, include_memory: includeMemory });

export const listKnowledge = (q = "", domain = "") => {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (domain) params.set("domain", domain);
  const suffix = params.toString() ? `?${params}` : "";
  return getJson<{ cards: KnowledgeCard[]; stats: Record<string, number> }>(`/api/knowledge${suffix}`);
};

export const deliberate = (
  question: string,
  depth: string,
  provider?: string,
  fact_sheet?: FactSheet,
  advisor_ids?: string[],
  clarifications?: ClarifyAnswer[],
  includeMemory = false,
) =>
  sendJson<CouncilResult>("/api/council/deliberate", "POST", {
    question, depth, provider, fact_sheet, advisor_ids, clarifications, include_memory: includeMemory,
  });

export const chat = (
  advisorId: string,
  question: string,
  sessionId: string | undefined,
  depth: string,
  provider?: string,
  includeMemory = false,
) =>
  sendJson<{
    session_id: string; advisor_id: string; answer: string;
    provider: string; model: string | null; citations: Citation[];
  }>(`/api/advisors/${advisorId}/chat`, "POST", {
    question, session_id: sessionId, depth, provider, include_memory: includeMemory,
  });

export const listDecisions = (tag?: string, status?: string) => {
  const q = new URLSearchParams();
  if (tag) q.set("tag", tag);
  if (status) q.set("status", status);
  const qs = q.toString();
  return getJson<{ decisions: Decision[] }>(`/api/decisions${qs ? "?" + qs : ""}`);
};
export const patchDecision = (id: string, changes: Partial<Decision>) =>
  sendJson<Decision>(`/api/decisions/${id}`, "PATCH", changes);
export const reviewDecision = (id: string, review_outcome: string) =>
  sendJson<Decision>(`/api/decisions/${id}/review`, "POST", { review_outcome });

export const getOrgMemory = () => getJson<OrgMemory>("/api/org-memory");
export const putOrgMemory = (org: Omit<OrgMemory, "updated_at_utc">) =>
  sendJson<OrgMemory>("/api/org-memory", "PUT", org);

export function categoryLabel(cat: string): string {
  return { sage: "古圣", expert: "专业视角", psychology: "心理", analyst: "分析师" }[cat] ?? cat;
}

// 多轮圆桌：SSE over POST（fetch 流式读取，支持较大的 transcript 请求体）
export interface RoundStreamHandlers {
  agenda?: (agenda: RoundAgenda) => void;
  turn?: (t: DialogueEntry) => void;
  roundSummary?: (summary: RoundSummary) => void;
  token?: (tok: string) => void;
  done?: (d: any) => void;
  error?: (msg: string) => void;
}

async function postStream(
  url: string,
  body: unknown,
  on: RoundStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: apiHeaders(true),
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const message = "请求失败（" + res.status + "）";
    on.error?.(message);
    throw new Error(message);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let terminal = false;
  let streamError = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        let ev = "";
        const dataLines: string[] = [];
        for (const line of block.split("\n")) {
          if (line.startsWith("event:")) ev = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
        }
        if (!ev) continue;
        const data = dataLines.join("\n");
        const parsed = data ? JSON.parse(data) : null;
        if (ev === "agenda") on.agenda?.(parsed as RoundAgenda);
        else if (ev === "turn") on.turn?.(parsed as DialogueEntry);
        else if (ev === "round_summary") on.roundSummary?.(parsed as RoundSummary);
        else if (ev === "token") on.token?.(parsed as string);
        else if (ev === "done") {
          terminal = true;
          on.done?.(parsed);
        } else if (ev === "error") {
          terminal = true;
          streamError = (parsed && parsed.message) || "出错了";
          on.error?.(streamError);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  if (streamError) throw new Error(streamError);
  if (!terminal) {
    const message = "流式响应意外中断，未收到完成标记。";
    on.error?.(message);
    throw new Error(message);
  }
}

export interface RoundBody {
  question: string; depth: string; provider?: string; advisor_ids?: string[];
  background?: string; transcript: unknown[]; summaries: RoundSummary[]; round_index: number;
  participation: Participation; include_memory?: boolean;
}
export interface CloseBody {
  question: string; depth: string; provider?: string; background?: string; transcript: unknown[];
  summaries: RoundSummary[]; decision_map?: DecisionMap; include_memory?: boolean;
}

export const streamRound = (body: RoundBody, on: RoundStreamHandlers, signal?: AbortSignal) =>
  postStream("/api/council/round", body, on, signal);
export const streamClose = (body: CloseBody, on: RoundStreamHandlers, signal?: AbortSignal) =>
  postStream("/api/council/close", body, on, signal);
