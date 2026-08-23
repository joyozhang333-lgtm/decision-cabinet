from __future__ import annotations

import stat
import pytest

from cabinet.schema import (
    ChatMessage,
    Decision,
    OrgMemory,
    utc_now_iso,
)
from cabinet.store import CabinetStore, NotFoundError


def _store() -> CabinetStore:
    return CabinetStore(":memory:")


def test_database_file_is_private_by_default(tmp_path) -> None:
    path = tmp_path / "private.db"
    store = CabinetStore(str(path))
    try:
        assert stat.S_IMODE(path.stat().st_mode) == 0o600
    finally:
        store.close()


def _decision(did: str, *, status: str = "decided", tags=(), chosen="A") -> Decision:
    now = utc_now_iso()
    return Decision(
        id=did, title=f"决策{did}", context="背景", council_session_id=None,
        options_considered=("A", "B"), chosen=chosen, rationale="理由",
        expectation="预期", tags=tuple(tags), status=status,
        review_outcome=None, reviewed_at_utc=None, created_at_utc=now, updated_at_utc=now,
    )


def test_org_memory_seed_and_save() -> None:
    store = _store()
    seeded = store.get_org_memory()
    assert seeded.mission  # 种子已写入
    custom = OrgMemory(
        mission="新使命", values=("v1",), audience=("a1",), product_lines=("p1",),
        constraints=("c1",), voice_and_taste="沉静", updated_at_utc="x",
    )
    saved = store.save_org_memory(custom)
    assert saved.mission == "新使命"
    assert store.get_org_memory().mission == "新使命"
    assert saved.updated_at_utc != "x"  # 保存时刷新时间戳


def test_decision_crud_review_and_recent() -> None:
    store = _store()
    store.save_decision(_decision("d1", status="decided", tags=("市场",)))
    store.save_decision(_decision("d2", status="draft"))
    store.save_decision(_decision("d3", status="decided", tags=("供应链",)))

    assert store.get_decision("d1").title == "决策d1"
    with pytest.raises(NotFoundError):
        store.get_decision("nope")

    # 过滤
    assert {d.id for d in store.list_decisions(status="decided")} == {"d1", "d3"}
    assert [d.id for d in store.list_decisions(tag="供应链")] == ["d3"]

    # 复盘
    reviewed = store.review_decision("d1", "上线后转化超预期")
    assert reviewed.status == "reviewed"
    assert reviewed.review_outcome == "上线后转化超预期"

    # recent 只取 decided/reviewed
    recent_ids = {d.id for d in store.recent_decisions(n=5)}
    assert "d2" not in recent_ids  # draft 不计入
    assert {"d1", "d3"} <= recent_ids

    # update
    updated = store.update_decision("d3", {"chosen": "B", "status": "reviewed"})
    assert updated.chosen == "B"
    assert updated.status == "reviewed"


def test_chat_session_roundtrip_and_append() -> None:
    store = _store()
    session = store.get_or_create_chat_session(None, "laozi")
    assert session.advisor_id == "laozi"
    session = session.append(
        ChatMessage(role="user", content="你好", created_at_utc=utc_now_iso()),
        ChatMessage(role="assistant", content="无为", created_at_utc=utc_now_iso()),
    )
    store.save_chat_session(session)
    loaded = store.get_chat_session(session.session_id)
    assert len(loaded.messages) == 2
    assert loaded.messages[0].content == "你好"
    assert loaded.advisor_id == "laozi"
