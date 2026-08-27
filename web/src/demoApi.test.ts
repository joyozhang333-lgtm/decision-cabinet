import { describe, expect, test } from "vitest";
import type { Participation, RoundSummary } from "./api";
import { clearDemoSessionData, demoAgenda } from "./demoApi";

const decisionsKey = "decision-cabinet-demo-decisions-v1";
const orgKey = "decision-cabinet-demo-org-v1";

function summaryWithDissents(dissents: string[]): RoundSummary {
  return {
    round: 1,
    phase: "facts",
    title: "事实定界",
    topics: ["核对事实"],
    positions: [],
    provisional_conclusions: [],
    consensus: [],
    dissents,
    questions_for_user: [],
    next_round_focus: [],
    created_at_utc: "2026-01-01T00:00:00.000Z",
  };
}

const listen: Participation = { mode: "listen", content: "" };

describe("demoAgenda", () => {
  test("第二轮没有上一轮非共识时仍提供默认交锋议题", () => {
    const agenda = demoAgenda(2, [summaryWithDissents([])], listen);

    expect(agenda.topics).toEqual([
      "争议：现在行动还是先验证",
      "争议：机会窗口是否足以覆盖承载代价",
    ]);
  });

  test("第二轮优先沿用上一轮明确的非共识", () => {
    const agenda = demoAgenda(2, [summaryWithDissents(["先验证需求还是先建立渠道"])], listen);

    expect(agenda.topics).toEqual(["争议：先验证需求还是先建立渠道"]);
  });
});

test("清理 Demo 数据时同时移除当前 sessionStorage 和旧 localStorage", () => {
  for (const storage of [window.sessionStorage, window.localStorage]) {
    storage.setItem(decisionsKey, "synthetic-decisions");
    storage.setItem(orgKey, "synthetic-org");
    storage.setItem("unrelated", "keep");
  }

  clearDemoSessionData();

  for (const storage of [window.sessionStorage, window.localStorage]) {
    expect(storage.getItem(decisionsKey)).toBeNull();
    expect(storage.getItem(orgKey)).toBeNull();
    expect(storage.getItem("unrelated")).toBe("keep");
  }
});
