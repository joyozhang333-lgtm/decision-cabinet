from __future__ import annotations

from cabinet.decision_map import (
    MAX_EVOLUTION_PATHS,
    MAX_OPTIONS,
    classify_decision,
    decision_map_from_dict,
    fallback_decision_map,
)


def test_decision_type_classification() -> None:
    assert classify_decision("是否买入这只股票？") == "investment"
    assert classify_decision("Should I buy AAPL stock?") == "investment"
    assert classify_decision("Should I buy a Treasury bond?") == "investment"
    assert classify_decision("How should I size this stock position?") == "investment"
    assert classify_decision("是否加仓ETF？") == "investment"
    assert classify_decision("要不要配置债券？") == "investment"
    assert classify_decision("公司新产品定价多少？") == "business"
    assert classify_decision("人生转折要不要离开这座城市？") == "life"
    assert classify_decision("Which option should we choose for hiring?") != "investment"
    assert classify_decision("How should we position our brand?") != "investment"
    assert classify_decision("How can we strengthen the bond in our marriage?") != "investment"


def test_local_investment_classification_overrides_model_type() -> None:
    mapped = decision_map_from_dict(
        {"decision_type": "mixed", "facts": ["股价已上涨"]},
        classified_type="investment",
    )
    assert mapped.decision_type == "investment"
    assert any("法定披露" in item for item in mapped.evidence_to_collect)


def test_decision_map_parses_options_costs_and_evolution() -> None:
    mapped = decision_map_from_dict({
        "decision_type": "investment",
        "core_question": "是否买入 A 公司",
        "objective": "长期增值，同时控制永久损失",
        "constraints": ["三年内可能用钱"],
        "stakeholders": ["家庭"],
        "options": [{
            "name": "观察后分批买入",
            "gains": ["保留上行"],
            "direct_costs": ["占用现金"],
            "opportunity_costs": ["放弃其他标的"],
            "risks": ["估值下修"],
            "second_order_effects": ["上涨后仓位集中"],
            "reversibility": "流动性正常时可卖出，但亏损不可逆",
        }],
        "tensions": ["收益与安全"],
        "yin_yang_cycles": ["上涨强化叙事，也累积估值风险"],
        "evolution_paths": [{
            "name": "下行", "trigger": "盈利不及预期", "near_term": "估值下修",
            "medium_term": "融资成本上升", "leading_signals": ["现金流转弱"], "response": "复核论点",
        }],
        "evidence_to_collect": ["最新年报"],
        "stop_conditions": ["论点被证伪"],
        "knowledge_ids": ["portfolio-risk"],
        "confidence_note": "仍缺最新披露",
    })
    assert mapped.decision_type == "investment"
    assert mapped.options[0].opportunity_costs == ("放弃其他标的",)
    assert len(mapped.options) == 3
    assert mapped.options[-1].name == "暂不行动，保留选择权"
    assert mapped.evolution_paths[0].leading_signals == ("现金流转弱",)
    assert "停止/退出条件" in mapped.as_text()


def test_offline_investment_map_does_not_fake_market_data() -> None:
    mapped = fallback_decision_map("现在是否应该买入某只股票？")
    assert mapped.decision_type == "investment"
    assert any("法定披露" in item for item in mapped.evidence_to_collect)
    assert any("论点" in item for item in mapped.stop_conditions)
    assert len(mapped.options) == 3
    assert any("选择权" in option.name for option in mapped.options)
    assert "离线骨架" in mapped.confidence_note


def test_empty_model_options_are_completed_with_real_alternatives() -> None:
    mapped = decision_map_from_dict({"decision_type": "life", "options": []})
    assert len(mapped.options) == 3
    assert {option.name for option in mapped.options} == {
        "分阶段推进当前方案",
        "先做最小可逆试验",
        "暂不行动，保留选择权",
    }


def test_investment_map_downgrades_unverified_facts_and_rejects_model_urls() -> None:
    mapped = decision_map_from_dict(
        {
            "decision_type": "investment",
            "facts": ["当前价格为 100，利润增长 30%"],
            "source_urls": ["https://example.invalid/fake"],
            "confidence_note": "完全确定",
            "options": [],
            "evolution_paths": [],
        },
        fallback_source_urls=("https://www.investor.gov/introduction-investing",),
    )
    assert mapped.facts == ()
    assert any("待原始来源逐项核实" in item for item in mapped.inferences)
    assert mapped.source_urls == ("https://www.investor.gov/introduction-investing",)
    assert "金融安全校验" in mapped.confidence_note
    assert len(mapped.evolution_paths) >= 3
    assert len(mapped.evidence_to_collect) >= 3
    assert len(mapped.stop_conditions) >= 3


def test_all_model_facts_require_item_level_verification() -> None:
    mapped = decision_map_from_dict({"decision_type": "business", "facts": ["市场规模为 100 亿"]})
    assert mapped.facts == ()
    assert any("待原始来源逐项核实" in item for item in mapped.inferences)


def test_model_output_is_bounded_to_close_request_contract() -> None:
    option = {"name": "x" * 1000, "gains": ["g" * 1000] * 30}
    path = {"name": "p" * 1000, "leading_signals": ["s" * 1000] * 30}
    mapped = decision_map_from_dict({
        "decision_type": "business",
        "options": [option] * 30,
        "evolution_paths": [path] * 30,
    })
    assert len(mapped.options) <= MAX_OPTIONS
    assert len(mapped.evolution_paths) <= MAX_EVOLUTION_PATHS
    assert all(len(item.name) <= 240 for item in mapped.options)
    assert all(len(signal) <= 500 for item in mapped.evolution_paths for signal in item.leading_signals)


def test_sparse_model_map_keeps_required_decision_context() -> None:
    mapped = decision_map_from_dict({}, fallback_question="是否进入新市场？")
    assert mapped.core_question == "是否进入新市场？"
    assert mapped.objective
    assert mapped.constraints


def test_model_cannot_forge_knowledge_card_ids() -> None:
    mapped = decision_map_from_dict({"knowledge_ids": ["not-a-real-card", "portfolio-risk"]})
    assert mapped.knowledge_ids == ("portfolio-risk",)
    retrieved = decision_map_from_dict(
        {"knowledge_ids": ["not-a-real-card"]},
        fallback_knowledge_ids=("decision-quality",),
    )
    assert retrieved.knowledge_ids == ("decision-quality",)
