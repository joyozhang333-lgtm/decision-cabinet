"""可追溯知识库：Markdown 知识卡加载、检索与 prompt 摘要。"""
from __future__ import annotations

import re
from collections import Counter
from functools import lru_cache
from pathlib import Path

from .schema import KnowledgeCard, KnowledgeSource

RESOURCES_ROOT = Path(__file__).resolve().parent / "resources"
KNOWLEDGE_DIR = RESOURCES_ROOT / "knowledge"
VALID_DOMAINS = {"decision", "business", "finance", "management", "wisdom"}
VALID_TRADITIONS = {"china", "international", "universal"}

DOMAIN_LABELS = {
    "decision": "决策科学",
    "business": "商业与经营",
    "finance": "金融与投资",
    "management": "管理学",
    "wisdom": "传统与世界智慧",
}

_DOMAIN_HINTS = {
    "investment": ("finance",),
    "股票": ("finance",),
    "基金": ("finance",),
    "估值": ("finance",),
    "仓位": ("finance",),
    "投资": ("finance",),
    "商业": ("business", "management"),
    "公司": ("business", "management"),
    "产品": ("business",),
    "定价": ("business", "finance"),
    "团队": ("management",),
    "组织": ("management",),
    "人生": ("wisdom", "decision"),
    "关系": ("wisdom", "decision"),
    "转折": ("wisdom", "decision"),
}


@lru_cache(maxsize=1)
def load_all_knowledge() -> tuple[KnowledgeCard, ...]:
    cards = [_load_card(path) for path in sorted(KNOWLEDGE_DIR.glob("*/*.md"))]
    return tuple(card for card in cards if card is not None)


def knowledge_stats() -> dict[str, int]:
    counts = Counter(card.domain for card in load_all_knowledge())
    return {domain: counts.get(domain, 0) for domain in DOMAIN_LABELS}


def get_knowledge_card(card_id: str) -> KnowledgeCard:
    for card in load_all_knowledge():
        if card.id == card_id:
            return card
    raise KeyError(card_id)


def search_knowledge(
    query: str,
    *,
    domains: tuple[str, ...] | None = None,
    limit: int = 8,
) -> tuple[KnowledgeCard, ...]:
    """轻量本地检索；无 embedding 依赖，适合开源默认安装。"""
    normalized = query.lower().strip()
    wanted = {d for d in (domains or ()) if d in VALID_DOMAINS}
    hinted: set[str] = set()
    for needle, domain_names in _DOMAIN_HINTS.items():
        if needle in normalized:
            hinted.update(domain_names)

    ascii_tokens = set(re.findall(r"[a-z0-9][a-z0-9_-]{1,}", normalized))
    chinese_chunks = re.findall(r"[\u4e00-\u9fff]{2,}", normalized)
    chinese_tokens = {chunk for chunk in chinese_chunks}
    for chunk in chinese_chunks:
        chinese_tokens.update(chunk[i:i + 2] for i in range(max(0, len(chunk) - 1)))
    tokens = ascii_tokens | chinese_tokens

    ranked: list[tuple[int, str, KnowledgeCard]] = []
    for card in load_all_knowledge():
        if wanted and card.domain not in wanted:
            continue
        haystack = " ".join((card.title, card.summary, " ".join(card.tags), " ".join(card.questions))).lower()
        score = 0
        if card.domain in hinted:
            score += 8
        if card.domain == "decision":
            score += 2
        for token in tokens:
            if len(token) >= 2 and token in haystack:
                score += 2 if token in card.tags else 1
        ranked.append((score, card.id, card))
    ranked.sort(key=lambda item: (-item[0], item[1]))
    positive = [card for score, _, card in ranked if score > 0]
    if positive:
        return tuple(positive[: max(1, limit)])
    return tuple(card for _, _, card in ranked[: max(1, limit)])


def knowledge_digest(cards: tuple[KnowledgeCard, ...], *, max_chars: int = 7000) -> str:
    blocks: list[str] = []
    for card in cards:
        method = "；".join(card.method[:4])
        boundary = "；".join(card.boundaries[:2])
        sources = "、".join(source.label for source in card.sources[:3]) or "内部方法卡"
        blocks.append(
            f"【{card.id}｜{card.title}｜{DOMAIN_LABELS.get(card.domain, card.domain)}】\n"
            f"{card.summary}\n方法：{method}\n边界：{boundary}\n来源：{sources}"
        )
    text = "\n\n".join(blocks)
    if len(text) > max_chars:
        return text[:max_chars].rstrip() + "\n……（相关知识已截断）"
    return text


def clear_cache() -> None:
    load_all_knowledge.cache_clear()


def _load_card(path: Path) -> KnowledgeCard | None:
    title, sections = _parse_sections(path)
    card_id = _one(sections, "ID") or path.stem
    domain = (_one(sections, "领域") or path.parent.name).lower()
    tradition = (_one(sections, "传统") or "universal").lower()
    if domain not in VALID_DOMAINS or tradition not in VALID_TRADITIONS:
        return None
    return KnowledgeCard(
        id=card_id,
        title=title,
        domain=domain,
        tradition=tradition,
        tags=_csv(sections.get("标签", [])),
        summary=_join(sections.get("摘要", [])),
        questions=_bullets(sections.get("关键问题", [])),
        method=_bullets(sections.get("方法", [])),
        boundaries=_bullets(sections.get("边界", [])),
        sources=_sources(sections.get("来源", [])),
        path=str(Path("cabinet") / "resources" / path.relative_to(RESOURCES_ROOT)),
    )


def _parse_sections(path: Path) -> tuple[str, dict[str, list[str]]]:
    title = path.stem
    current: str | None = None
    sections: dict[str, list[str]] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line.startswith("# "):
            title = line[2:].strip()
        elif line.startswith("## "):
            current = line[3:].strip()
            sections.setdefault(current, [])
        elif current and line:
            sections[current].append(line)
    return title, sections


def _one(sections: dict[str, list[str]], key: str) -> str:
    return _join(sections.get(key, []))


def _join(lines: list[str]) -> str:
    return " ".join(line.removeprefix("- ").strip() for line in lines).strip()


def _csv(lines: list[str]) -> tuple[str, ...]:
    raw = _join(lines)
    return tuple(x.strip().lower() for x in re.split(r"[,，、]", raw) if x.strip())


def _bullets(lines: list[str]) -> tuple[str, ...]:
    values = [line[2:].strip() for line in lines if line.startswith("- ")]
    return tuple(values or ([_join(lines)] if _join(lines) else []))


_SOURCE_RE = re.compile(r"^- \[(?P<label>[^]]+)]\((?P<url>https?://[^)]+)\)(?:\s*\|\s*(?P<kind>[a-z]+))?")


def _sources(lines: list[str]) -> tuple[KnowledgeSource, ...]:
    out: list[KnowledgeSource] = []
    for line in lines:
        match = _SOURCE_RE.match(line)
        if not match:
            continue
        out.append(KnowledgeSource(
            label=match.group("label"),
            url=match.group("url"),
            source_type=match.group("kind") or "official",
        ))
    return tuple(out)
