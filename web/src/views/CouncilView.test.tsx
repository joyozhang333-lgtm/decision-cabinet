import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type {
  AdvisorPublic,
  DecisionMap,
  DialogueEntry,
  RoundAgenda,
  RoundBody,
  RoundSummary,
  RoundStreamHandlers,
} from "../api";
import * as api from "../api";
import CouncilView from "./CouncilView";

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return {
    ...actual,
    listAdvisors: vi.fn(),
    patchDecision: vi.fn(),
    requestClarify: vi.fn(),
    requestDecisionMap: vi.fn(),
    streamClose: vi.fn(),
    streamRound: vi.fn(),
  };
});

vi.mock("../demoApi", () => ({ isDemoMode: false }));

const advisors: AdvisorPublic[] = [
  {
    id: "analyst",
    name: "证据分析师",
    category: "analyst",
    group: "商业判断",
    lineage: "事实与推断",
    core_insight: "先区分事实与判断",
    lens: ["证据"],
    canon: [],
  },
  {
    id: "drucker",
    name: "结果顾问",
    category: "expert",
    group: "商业判断",
    lineage: "外部成果",
    core_insight: "用可观察结果校验方向",
    lens: ["成果"],
    canon: [],
  },
];

const decisionMap: DecisionMap = {
  decision_type: "business",
  core_question: "是否先做一个小规模社区活动试验？",
  objective: "验证真实参与意愿，同时保留调整空间",
  constraints: ["预算有限", "六周后复盘"],
  stakeholders: ["参与者", "执行团队"],
  options: [{
    name: "先做小规模试验",
    gains: ["获得真实反馈"],
    direct_costs: ["投入有限预算"],
    opportunity_costs: ["推迟全面投入"],
    risks: ["样本可能偏差"],
    second_order_effects: ["建立验证习惯"],
    reversibility: "高",
  }],
  tensions: ["行动速度与证据质量"],
  yin_yang_cycles: ["投入过快可能让动量转成负担"],
  evolution_paths: [{
    name: "试验有效",
    trigger: "参与率达到门槛",
    near_term: "继续观察",
    medium_term: "分阶段扩大",
    leading_signals: ["复购意愿"],
    response: "保持阶段预算",
  }],
  evidence_to_collect: ["报名到场率"],
  stop_conditions: ["连续两次低于门槛"],
  knowledge_ids: [],
  confidence_note: "这是合成测试数据。",
  data_as_of: "2026-01-01",
  source_urls: [],
  facts: ["尚未进行线下试验"],
  inferences: ["小规模试验可能降低错误成本"],
};

const phaseByRound: Record<number, RoundAgenda["phase"]> = {
  1: "facts",
  2: "debate",
  3: "stress_test",
  4: "convergence",
};

function agendaFor(round: number): RoundAgenda {
  return {
    round,
    phase: phaseByRound[round],
    title: `第${round}轮合成议题`,
    objective: `推进第${round}轮判断`,
    topics: [`第${round}轮讨论焦点`],
    opening_speaker_id: "analyst",
  };
}

function turnFor(round: number, advisor: AdvisorPublic, suffix = "判断"): DialogueEntry {
  return {
    round,
    role: "advisor",
    speaker_id: advisor.id,
    speaker_name: advisor.name,
    lineage: advisor.lineage,
    content: `第${round}轮-${advisor.name}${suffix}`,
    citations: [],
    provider: "test-provider",
    model: "synthetic-model",
    entry_id: `${advisor.id}-r${round}-${suffix}`,
    reply_to_id: "",
    reply_to_name: "",
    reply_excerpt: "",
    stance: advisor.id === "analyst" ? "refine" : "challenge",
    novelty: round === 1 ? "new" : "refined",
    participation_mode: "",
    delta_type: round === 1 ? "claim" : "condition",
    delta: `第${round}轮新增条件`,
  };
}

function summaryFor(round: number, turns: DialogueEntry[]): RoundSummary {
  return {
    round,
    phase: phaseByRound[round],
    title: `第${round}轮纪要`,
    topics: [`第${round}轮讨论焦点`],
    positions: turns.map((turn) => ({
      speaker_id: turn.speaker_id,
      speaker_name: turn.speaker_name,
      claim: turn.content,
      stance: turn.stance,
      responds_to_name: turn.reply_to_name,
      responds_to_id: turn.reply_to_id,
      role: "advisor",
    })),
    provisional_conclusions: [`第${round}轮小结`],
    consensus: [`第${round}轮共识`],
    dissents: [`第${round}轮非共识`],
    questions_for_user: [`请补充第${round}轮事实边界。`],
    next_round_focus: [`进入第${round + 1}轮`],
    created_at_utc: `2026-01-0${round}T00:00:00.000Z`,
  };
}

function completeRound(body: RoundBody, handlers: RoundStreamHandlers): void {
  const agenda = agendaFor(body.round_index);
  const turns = advisors.map((advisor) => turnFor(body.round_index, advisor));
  const summary = summaryFor(body.round_index, turns);
  handlers.agenda?.(agenda);
  turns.forEach((turn) => handlers.turn?.(turn));
  handlers.roundSummary?.(summary);
  handlers.done?.({ round: body.round_index, turns, summary });
}

async function startCouncil(user: ReturnType<typeof userEvent.setup>) {
  const rendered = render(<CouncilView provider="" />);
  await screen.findByRole("button", { name: "证据分析师" });
  await user.type(screen.getByLabelText("你要讨论的决策"), "是否先做一个小规模社区活动试验？");
  await user.click(screen.getByRole("button", { name: "先看选择与代价" }));
  const start = await screen.findByRole("button", { name: "带着地图，召开圆桌" });
  await user.click(start);
  return rendered;
}

beforeEach(() => {
  vi.mocked(api.listAdvisors).mockResolvedValue({ advisors });
  vi.mocked(api.requestDecisionMap).mockResolvedValue(decisionMap);
  vi.mocked(api.patchDecision).mockResolvedValue({
    id: "decision-synthetic",
    title: decisionMap.core_question,
    context: decisionMap.core_question,
    council_session_id: null,
    options_considered: ["先做小规模试验"],
    chosen: "先做一次六周试验",
    rationale: "先验证最昂贵的不确定性",
    expectation: "六周后复盘",
    tags: ["可逆试验"],
    status: "decided",
    review_outcome: null,
    reviewed_at_utc: null,
    created_at_utc: "2026-01-01T00:00:00.000Z",
    updated_at_utc: "2026-01-01T00:00:00.000Z",
    decision_map: decisionMap,
  });
});

describe("CouncilView 四轮交互", () => {
  test("用户发言作为创始人观点进入下一轮", async () => {
    vi.mocked(api.streamRound).mockImplementation(async (body, handlers) => completeRound(body, handlers));
    const user = userEvent.setup();
    await startCouncil(user);
    await screen.findAllByText("第1轮-证据分析师判断");

    const statement = "预算上限为十万元，并在六周后复盘。";
    await user.type(screen.getByLabelText("你的发言"), statement);
    await user.click(screen.getByRole("button", { name: "带着这句话进入第 2 轮" }));
    await screen.findAllByText("第2轮-证据分析师判断");

    const secondBody = vi.mocked(api.streamRound).mock.calls[1][0];
    expect(secondBody.participation).toMatchObject({ mode: "answer", content: statement });
    expect(secondBody.transcript).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "founder", content: statement, participation_mode: "answer" }),
    ]));
    expect(screen.getByText(statement)).toBeInTheDocument();
  });

  test("首轮流式失败撤回半成品，只保留重试且不会渲染空控制卡", async () => {
    let attempt = 0;
    vi.mocked(api.streamRound).mockImplementation(async (body, handlers) => {
      attempt += 1;
      if (attempt === 1) {
        handlers.agenda?.(agendaFor(1));
        handlers.turn?.(turnFor(1, advisors[0], "未完成内容"));
        throw new Error("模拟网络故障");
      }
      completeRound(body, handlers);
    });
    const user = userEvent.setup();
    const { container } = render(<CouncilView provider="" />);
    await screen.findByRole("button", { name: "证据分析师" });
    await user.type(screen.getByLabelText("你要讨论的决策"), "是否先做一个合成试验？");
    await user.click(screen.getByRole("button", { name: "先看选择与代价" }));
    await user.click(await screen.findByRole("button", { name: "带着地图，召开圆桌" }));

    await screen.findByRole("alert");
    expect(screen.queryByText("第1轮-证据分析师未完成内容")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "修改我的参与方式" })).not.toBeInTheDocument();
    expect(container.querySelector(".controls")).toBeNull();

    await user.click(screen.getByRole("button", { name: "重试第 1 轮" }));
    await screen.findAllByText("第1轮-证据分析师判断");
    expect(api.streamRound).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("第1轮-证据分析师未完成内容")).not.toBeInTheDocument();
  });

  test("只听模式可完成四轮、收束、保存并开始新决策", async () => {
    vi.mocked(api.streamRound).mockImplementation(async (body, handlers) => completeRound(body, handlers));
    let closeAttempt = 0;
    vi.mocked(api.streamClose).mockImplementation(async (_body, handlers) => {
      closeAttempt += 1;
      if (closeAttempt === 1) {
        handlers.token?.("未完成的合成收束");
        throw new Error("模拟收束中断");
      }
      handlers.token?.("合成收束内容");
      handlers.done?.({
        decision_id: "decision-synthetic",
        close: {
          ...turnFor(4, advisors[0]),
          role: "facilitator",
          speaker_id: "facilitator",
          speaker_name: "主持人",
          content: "合成收束内容",
          entry_id: "close-synthetic",
          stance: "synthesize",
        },
      });
    });
    const user = userEvent.setup();
    const { container } = await startCouncil(user);
    await screen.findAllByText("第1轮-证据分析师判断");

    for (const nextRound of [2, 3, 4]) {
      await user.click(screen.getByRole("radio", { name: /先旁听/ }));
      await user.click(screen.getByRole("button", { name: `旁听第 ${nextRound} 轮` }));
      await screen.findAllByText(`第${nextRound}轮-证据分析师判断`);
    }

    expect(api.streamRound).toHaveBeenCalledTimes(4);
    for (const call of vi.mocked(api.streamRound).mock.calls.slice(1)) {
      expect(call[0].participation).toEqual({ mode: "listen", content: "" });
    }

    await user.click(screen.getByRole("button", { name: "请内阁收束" }));
    await screen.findByRole("alert");
    expect(screen.queryByText("未完成的合成收束")).not.toBeInTheDocument();
    expect(container.querySelector(".controls")).toBeNull();
    await user.click(screen.getByRole("button", { name: "重试收束" }));
    await screen.findByText("现在，轮到你 · 把你的决定定下来");
    expect(api.streamClose).toHaveBeenCalledTimes(2);

    await user.type(screen.getByLabelText("我的决定"), "先做一次六周的可逆试验");
    await user.type(screen.getByLabelText("我这样定的理由"), "先验证最昂贵的不确定性");
    await user.click(screen.getByRole("button", { name: "记下我的决定" }));
    await screen.findByText(/已存入决策日志/);
    expect(api.patchDecision).toHaveBeenCalledWith("decision-synthetic", expect.objectContaining({
      chosen: "先做一次六周的可逆试验",
      status: "decided",
    }));

    await user.click(screen.getByRole("button", { name: "开始一个新决策" }));
    await waitFor(() => expect(screen.getByLabelText("你要讨论的决策")).toHaveValue(""));
    expect(screen.queryByText("四轮议事已完成。")).not.toBeInTheDocument();
  });
});
