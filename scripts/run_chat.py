#!/usr/bin/env python3
"""CLI 冒烟：与单位顾问对话。

    python scripts/run_chat.py huineng "我急着扩张，是否把成就感当成了事实？"
    python scripts/run_chat.py munger "该不该自己投钱做小程序？" --provider claude
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from cabinet import context, council  # noqa: E402
from cabinet.advisors import advisor_ids as list_advisor_ids, load_advisor  # noqa: E402
from cabinet.providers import get_provider  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="决策内阁 · 单聊")
    parser.add_argument("advisor", help=f"顾问 id，可选：{', '.join(list_advisor_ids())}")
    parser.add_argument("question")
    parser.add_argument("--provider", default=None)
    parser.add_argument("--depth", default="standard", choices=["brief", "standard", "deep"])
    args = parser.parse_args()

    advisor = load_advisor(args.advisor)
    provider = get_provider(args.provider)
    print(f"【{advisor.name}】{advisor.lineage}（{provider.name}, configured={provider.configured}）")
    print("-" * 64)

    content, prov, model, citations = council.chat_with_advisor(
        provider, advisor, args.question, context.DEFAULT_ORG_MEMORY, depth=args.depth
    )
    print(content)
    if citations:
        print("\n依据：" + "、".join(f"《{c.title}》" for c in citations))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
