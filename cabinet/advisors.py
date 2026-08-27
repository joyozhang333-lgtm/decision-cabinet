"""顾问与典籍加载器。

顾问即配置：
- `cabinet/resources/advisors/<id>.md` —— 视角配置
- `cabinet/resources/canon/<id>/*.md` —— 典籍原文或方法摘要

文件作为 Python 包资源随 wheel 分发，保留可审查的来源路径。
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from .schema import Advisor, CanonRef

PACKAGE_ROOT = Path(__file__).resolve().parent
RESOURCES_ROOT = PACKAGE_ROOT / "resources"
ADVISORS_DIR = RESOURCES_ROOT / "advisors"
CANON_DIR = RESOURCES_ROOT / "canon"
ADVISORS_INDEX = ADVISORS_DIR / "index.json"

VALID_CATEGORIES = {"sage", "expert", "psychology", "analyst"}

# 展示分组（决定圆桌/单聊里顾问的分组与顺序）。新增顾问加到对应组即可。
ADVISOR_GROUPS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("实事求是", ("analyst",)),
    ("商业·战略", ("munger", "drucker", "inamori", "zhangyiming", "wangxing", "zengming", "chenchunhua", "naval")),
    ("增长·品牌·社群", ("growth-strategist", "brand-positioning", "community-ops")),
    ("产品·课程", ("liangning", "course-design")),
    ("金融·投资", ("investment-analyst", "macro-economist", "cashflow-cfo")),
    ("法务·边界", ("legal-compliance",)),
    ("心理·照见", ("jung", "rogers")),
    ("对道·古圣", ("laozi", "zhuangzi", "kongzi", "wangyangming", "shakyamuni", "padmasambhava", "trungpa", "huineng")),
)
_GROUP_OF: dict[str, str] = {aid: g for g, ids in ADVISOR_GROUPS for aid in ids}


def group_of(advisor_id: str) -> str:
    return _GROUP_OF.get(advisor_id, "其他")


class AdvisorNotFoundError(KeyError):
    pass


def advisor_ids() -> tuple[str, ...]:
    """显示顺序：按 ADVISOR_GROUPS 编排（仅取磁盘上存在的）；未登记者按文件名追加在后。"""
    on_disk = {p.stem for p in ADVISORS_DIR.glob("*.md")} if ADVISORS_DIR.exists() else set()
    ordered = [aid for _, ids in ADVISOR_GROUPS for aid in ids if aid in on_disk]
    extras = sorted(on_disk - set(ordered))
    return tuple(ordered + extras)


@lru_cache(maxsize=1)
def load_all_advisors() -> tuple[Advisor, ...]:
    return tuple(load_advisor(aid) for aid in advisor_ids())


@lru_cache(maxsize=128)
def load_advisor(advisor_id: str) -> Advisor:
    # Advisor IDs cross API and MCP trust boundaries.  Treat the packaged index
    # as the allowlist before constructing a path so values such as "../x"
    # can never escape the advisor resource directory.
    if advisor_id not in advisor_ids():
        raise AdvisorNotFoundError(advisor_id)
    path = ADVISORS_DIR / f"{advisor_id}.md"
    resolved_path = path.resolve()
    if resolved_path.parent != ADVISORS_DIR.resolve() or not resolved_path.is_file():
        raise AdvisorNotFoundError(advisor_id)
    title, sections = _parse_markdown_sections(path, advisor_id)
    category = _join(sections.get("类别", [])).strip().lower() or "expert"
    if category not in VALID_CATEGORIES:
        category = "expert"
    return Advisor(
        id=advisor_id,
        name=title,
        category=category,
        group=group_of(advisor_id),
        lineage=_join(sections.get("传承", [])),
        voice_style=_join(sections.get("声音风格", [])),
        core_insight=_join(sections.get("核心见地", [])),
        lens=_bullets(sections.get("决策维度", [])),
        canon=_load_canon_for(advisor_id),
        guardrails=_bullets(sections.get("绝不偏离", [])),
        path=_public_resource_path(path),
    )


def get_advisors(advisor_ids_subset: tuple[str, ...] | None) -> tuple[Advisor, ...]:
    if not advisor_ids_subset:
        return load_all_advisors()
    return tuple(load_advisor(aid) for aid in advisor_ids_subset)


@lru_cache(maxsize=128)
def _load_canon_for(advisor_id: str) -> tuple[CanonRef, ...]:
    folder = CANON_DIR / advisor_id
    if not folder.exists():
        return ()
    refs: list[CanonRef] = []
    for path in sorted(folder.glob("*.md")):
        title, sections = _parse_markdown_sections(path, path.stem)
        quote = _join(sections.get("原文", []))
        paraphrase = _join(sections.get("摘要", []))
        text = quote or paraphrase
        if not text:
            continue
        refs.append(
            CanonRef(
                canon_id=path.stem,
                title=title,
                locator=_join(sections.get("出处", [])),
                quote=text,
                path=_public_resource_path(path),
                text_kind="quote" if quote else "paraphrase",
            )
        )
    return tuple(refs)


@lru_cache(maxsize=1)
def _index_order() -> tuple[str, ...]:
    if not ADVISORS_INDEX.exists():
        return ()
    try:
        data = json.loads(ADVISORS_INDEX.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return ()
    order = data.get("order")
    if isinstance(order, list):
        return tuple(str(x) for x in order)
    return ()


# --- Markdown 解析 ------------------------------------------------

def _parse_markdown_sections(path: Path, default_title: str) -> tuple[str, dict[str, list[str]]]:
    raw = path.read_text(encoding="utf-8").strip()
    title = default_title
    current_heading: str | None = None
    sections: dict[str, list[str]] = {}
    for line in raw.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("# "):
            title = stripped[2:].strip()
            continue
        if stripped.startswith("## "):
            current_heading = stripped[3:].strip()
            sections.setdefault(current_heading, [])
            continue
        if current_heading is None:
            continue
        sections.setdefault(current_heading, []).append(stripped)
    return title, sections


def _join(lines: list[str]) -> str:
    return " ".join(line.removeprefix("- ").strip() for line in lines).strip()


def _bullets(lines: list[str]) -> tuple[str, ...]:
    bullets = [line[2:].strip() for line in lines if line.startswith("- ")]
    if bullets:
        return tuple(bullets)
    content = _join(lines)
    return (content,) if content else ()


def _public_resource_path(path: Path) -> str:
    return str(Path("cabinet") / "resources" / path.relative_to(RESOURCES_ROOT))


def clear_cache() -> None:
    """测试 / 热更新顾问文件后调用。"""
    load_all_advisors.cache_clear()
    load_advisor.cache_clear()
    _load_canon_for.cache_clear()
    _index_order.cache_clear()
