import { describe, expect, expectTypeOf, test } from "vitest";
import type { CouncilPosition, DialogueEntry } from "./api";

describe("前后端圆桌契约", () => {
  test("delta_type 覆盖后端允许的全部值", () => {
    const values: NonNullable<DialogueEntry["delta_type"]>[] = [
      "claim",
      "new_evidence",
      "counterexample",
      "condition",
      "position_change",
      "evidence_request",
      "none",
    ];

    expect(values).toHaveLength(7);
  });

  test("会议纪要观点保留回应目标和发言角色", () => {
    const position: CouncilPosition = {
      speaker_id: "advisor-a",
      speaker_name: "合成顾问甲",
      claim: "先验证最昂贵的不确定性。",
      stance: "refine",
      responds_to_name: "合成顾问乙",
      responds_to_id: "turn-b",
      role: "advisor",
    };

    expectTypeOf(position.responds_to_id).toEqualTypeOf<string>();
    expectTypeOf(position.role).toEqualTypeOf<"advisor" | "founder">();
    expect(position.responds_to_id).toBe("turn-b");
  });
});
