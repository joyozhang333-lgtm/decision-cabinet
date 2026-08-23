from __future__ import annotations

from cabinet.knowledge import knowledge_stats, load_all_knowledge, search_knowledge


def test_knowledge_library_is_traceable_and_balanced() -> None:
    cards = load_all_knowledge()
    assert len(cards) >= 20
    assert len({card.id for card in cards}) == len(cards)
    stats = knowledge_stats()
    for required in ("decision", "business", "finance", "management", "wisdom"):
        assert stats[required] >= 3
    for card in cards:
        assert card.summary
        assert card.method
        assert card.boundaries
        assert card.sources
        assert all(source.url.startswith("https://") for source in card.sources)


def test_stock_query_prioritizes_finance_and_risk() -> None:
    cards = search_knowledge("我是否应该买入这只股票，仓位应该多大？", limit=8)
    ids = {card.id for card in cards}
    assert "portfolio-risk" in ids
    assert "investment-evidence" in ids
    assert sum(card.domain == "finance" for card in cards) >= 4


def test_life_query_brings_wisdom_and_decision_cards() -> None:
    cards = search_knowledge("人生转折时要不要离职去另一个城市？", limit=8)
    assert {card.domain for card in cards} >= {"decision", "wisdom"}
