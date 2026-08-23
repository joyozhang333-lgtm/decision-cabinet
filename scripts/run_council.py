#!/usr/bin/env python3
"""CLI 冒烟：开一次圆桌。

    python scripts/run_council.py "公司该直接进入新市场，还是先做一城试点？"
    python scripts/run_council.py "..." --depth deep --provider claude
    python scripts/run_council.py "..." --advisors analyst,munger,laozi

未配置 API key 时走本地 fallback，仍能跑通整个流程（便于离线验证）。
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from cabinet import context, council  # noqa: E402
from cabinet.providers import get_provider  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="决策内阁 · 圆桌")
    parser.add_argument("question", help="你抛给内阁的决策")
    parser.add_argument("--depth", default="standard", choices=["brief", "standard", "deep"])
    parser.add_argument("--provider", default=None, help="deepseek | claude | openai_compat")
    parser.add_argument("--advisors", default=None, help="逗号分隔的顾问 id；缺省=全体")
    args = parser.parse_args()

    provider = get_provider(args.provider)
    advisor_ids = tuple(x.strip() for x in args.advisors.split(",")) if args.advisors else None

    print("=" * 64)
    print(f"决策：{args.question}")
    print(f"模型：{provider.name}（configured={provider.configured}） · 深度：{args.depth}")
    print("=" * 64)

    def on_turn(turn) -> None:
        print(f"  ✓ {turn.advisor_name} 已发言（{turn.provider}）")

    session = council.deliberate(
        provider,
        args.question,
        org_memory=context.DEFAULT_ORG_MEMORY,
        advisor_ids=advisor_ids,
        depth=args.depth,
        on_turn=on_turn,
    )

    print("\n── 实事求是步 ──")
    print(session.fact_sheet.as_text())

    print("\n── 顾问发言 ──")
    for turn in session.turns:
        print(f"\n【{turn.advisor_name}】{turn.lineage}")
        print(turn.content)
        if turn.citations:
            print("  依据：" + "、".join(f"《{c.title}》" for c in turn.citations))

    print("\n── 综合裁决（五层）──")
    print(session.synthesis.raw_markdown)
    if session.synthesis.dissents:
        print("\n保留的异见：")
        for d in session.synthesis.dissents:
            print(f"  - {d}")

    draft = council.draft_decision_from_council(session)
    print(f"\n（已生成内存草稿 {draft.id}；CLI 不写入前端日志，持久化请使用 Web 圆桌或 API。）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
