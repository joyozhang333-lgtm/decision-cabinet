from __future__ import annotations

from pathlib import Path

from cabinet import personas
from cabinet.advisors import (
    VALID_CATEGORIES,
    advisor_ids,
    load_advisor,
    load_all_advisors,
)


def test_all_advisors_load_and_are_valid() -> None:
    advisors = load_all_advisors()
    assert len(advisors) >= 10
    for advisor in advisors:
        assert advisor.name
        assert advisor.category in VALID_CATEGORIES
        assert advisor.lineage
        assert advisor.core_insight
        assert advisor.lens  # 至少一个决策维度


def test_named_advisors_present() -> None:
    ids = set(advisor_ids())
    for required in ("laozi", "kongzi", "shakyamuni", "padmasambhava", "huineng", "munger", "drucker", "jung", "analyst"):
        assert required in ids


def test_sages_have_canon_with_existing_paths() -> None:
    for advisor in load_all_advisors():
        if advisor.category == "sage":
            assert advisor.canon, f"{advisor.id} 古圣必须有典籍依据"
            for ref in advisor.canon:
                assert ref.quote
                assert (Path(__file__).parents[1] / ref.path).exists(), f"典籍文件缺失：{ref.path}"


def test_public_paths_are_repository_relative() -> None:
    for advisor in load_all_advisors():
        assert advisor.path.startswith("cabinet/resources/advisors/")
        assert not Path(advisor.path).is_absolute()
        for ref in advisor.canon:
            assert ref.path.startswith("cabinet/resources/canon/")
            assert not Path(ref.path).is_absolute()


def test_sage_prompt_includes_canon_whitelist_and_guardrails() -> None:
    huineng = load_advisor("huineng")
    prompt = personas.build_advisor_system_prompt(huineng, org_digest="（测试组织背景）")
    assert personas.CABINET_SYSTEM_PREAMBLE[:12] in prompt
    assert "只能引用下列已校对的原文" in prompt  # 防杜撰白名单
    assert "本来无一物" in prompt  # 真实典籍原文进入了 prompt
    assert "你绝不偏离" in prompt
    assert "（测试组织背景）" not in prompt
    assert "不可信上下文边界" in prompt


def test_expert_prompt_uses_method_section_not_canon_whitelist() -> None:
    munger = load_advisor("munger")
    prompt = personas.build_advisor_system_prompt(munger, org_digest="x")
    assert "思维模型 / 方法依据" in prompt
    assert "反过来想" in prompt
    assert all(ref.text_kind == "paraphrase" for ref in munger.canon)
    assert "不得表述为逐字引语" in prompt
