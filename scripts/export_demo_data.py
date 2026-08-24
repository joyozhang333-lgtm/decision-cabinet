"""Export the public, non-sensitive catalog used by the GitHub Pages demo."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from cabinet.advisors import load_all_advisors
from cabinet.knowledge import knowledge_stats, load_all_knowledge


def build_payload() -> dict[str, Any]:
    """Return only the same public fields exposed by the read-only catalog API."""
    return {
        "config": {
            "product": "决策内阁",
            "api_version": "demo",
            "providers": {
                "default": "browser-demo",
                "providers": {
                    "browser-demo": {"configured": True, "model": None, "local": True}
                },
            },
            "depths": ["brief", "standard", "deep"],
            "advisor_count": len(load_all_advisors()),
            "knowledge_count": len(load_all_knowledge()),
            "knowledge_domains": knowledge_stats(),
            "philosophy": "先看事实，再看选择与代价，最后观察局势演化。",
            "disclaimer": "浏览器演示仅用于教育与决策支持，不构成投资、法律、医疗或税务建议。",
        },
        "advisors": [advisor.public_dict() for advisor in load_all_advisors()],
        "knowledge": [card.public_dict() for card in load_all_knowledge()],
        "knowledge_stats": knowledge_stats(),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(build_payload(), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
