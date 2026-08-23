"""决策档案摘要与讨论深度配置。"""
from __future__ import annotations

from .schema import Decision, OrgMemory

DEPTH_MODES = ("brief", "standard", "deep")


def normalize_depth(depth: str | None) -> str:
    return depth if depth in DEPTH_MODES else "standard"


def advisor_max_tokens(depth: str) -> int:
    return {"brief": 900, "standard": 1300, "deep": 1800}[normalize_depth(depth)]


def synthesis_max_tokens(depth: str) -> int:
    return {"brief": 1600, "standard": 2400, "deep": 3200}[normalize_depth(depth)]


def factsheet_max_tokens() -> int:
    return 1200


def chat_max_tokens(depth: str) -> int:
    return {"brief": 800, "standard": 1200, "deep": 1600}[normalize_depth(depth)]


# 开源默认档案必须中性、匿名。首次使用者在「决策档案」页填写自己的背景。
DEFAULT_ORG_MEMORY = OrgMemory(
    mission="（待填写）你长期想创造、守护或改变什么？",
    values=(
        "如实照见、实事求是",
        "选择与代价同时看见",
        "不以短期结果掩盖长期责任",
    ),
    audience=("（待填写）谁会直接受到你的决定影响？",),
    product_lines=("（待填写）你的业务、资产、责任或人生主线",),
    constraints=(
        "（待填写）时间、现金、精力、能力与不可逾越的边界",
    ),
    voice_and_taste="直接、诚实、清楚；区分事实、推断与未知；不替我拍板。",
    updated_at_utc="2026-08-23T00:00:00+00:00",
)


def build_org_memory_digest(
    org: OrgMemory,
    recent_decisions: tuple[Decision, ...] = (),
    *,
    max_chars: int = 6000,
) -> str:
    def join(items: tuple[str, ...]) -> str:
        return "；".join(items) if items else "（未填）"

    lines = [
        f"使命：{org.mission or '（未填）'}",
        f"价值观：{join(org.values)}",
        f"关键关系人/受影响者：{join(org.audience)}",
        f"业务、资产、责任或人生主线：{join(org.product_lines)}",
        f"现实约束：{join(org.constraints)}",
        f"调性与品味：{org.voice_and_taste or '（未填）'}",
    ]
    if recent_decisions:
        lines.append("最近的决策与结果（供参考，避免反复推翻已定之事）：")
        for d in recent_decisions:
            tags = f"［{ '、'.join(d.tags) }］" if d.tags else ""
            outcome = f"；复盘结果：{d.review_outcome}" if d.review_outcome else ""
            chosen = d.chosen or "（尚未拍板）"
            lines.append(f"  - {d.title}{tags}：选择={chosen}；理由={d.rationale}{outcome}")
    text = "\n".join(lines).strip()
    if len(text) > max_chars:
        text = text[:max_chars].rstrip() + "\n……（组织背景过长已截断）"
    return text
