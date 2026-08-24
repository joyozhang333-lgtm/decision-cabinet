from scripts.export_demo_data import build_payload


def test_demo_export_contains_only_public_catalog_fields() -> None:
    payload = build_payload()
    assert payload["config"]["advisor_count"] == 28
    assert payload["config"]["knowledge_count"] == 23
    assert len(payload["advisors"]) == 28
    assert len(payload["knowledge"]) == 23
    assert "guardrails" not in payload["advisors"][0]
    assert all("quote" not in canon for advisor in payload["advisors"] for canon in advisor["canon"])
