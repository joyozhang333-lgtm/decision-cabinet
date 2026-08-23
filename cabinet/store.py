"""SQLite 持久化。

决策日志 / 圆桌会话 / 单聊会话 / 组织记忆 落盘 —— 这是「决策操作系统」的根基。
存储接口不依赖 FastAPI；测试可注入 `:memory:`。
"""
from __future__ import annotations

import json
import os
import sqlite3
import threading
from dataclasses import replace
from pathlib import Path
from typing import Any
from uuid import uuid4

from .context import DEFAULT_ORG_MEMORY
from .schema import (
    ChatMessage,
    ChatSession,
    CouncilSession,
    Decision,
    OrgMemory,
    utc_now_iso,
)


class NotFoundError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


_SCHEMA = """
CREATE TABLE IF NOT EXISTS org_memory (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS decisions (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS council_sessions (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY,
    advisor_id TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    payload TEXT NOT NULL
);
"""


class CabinetStore:
    def __init__(self, db_path: str = "cabinet.db") -> None:
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        if db_path != ":memory:":
            os.chmod(Path(db_path), 0o600)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        with self._lock:
            self._conn.executescript(_SCHEMA)
            self._conn.commit()
            self._seed_org_memory_if_empty()

    # --- 组织记忆 -------------------------------------------------------

    def _seed_org_memory_if_empty(self) -> None:
        row = self._conn.execute("SELECT 1 FROM org_memory WHERE id = 1").fetchone()
        if row is None:
            self._conn.execute(
                "INSERT INTO org_memory (id, payload) VALUES (1, ?)",
                (json.dumps(DEFAULT_ORG_MEMORY.to_dict(), ensure_ascii=False),),
            )
            self._conn.commit()

    def get_org_memory(self) -> OrgMemory:
        row = self._conn.execute("SELECT payload FROM org_memory WHERE id = 1").fetchone()
        if row is None:
            return DEFAULT_ORG_MEMORY
        return _to_org_memory(json.loads(row["payload"]))

    def save_org_memory(self, org: OrgMemory) -> OrgMemory:
        org = replace(org, updated_at_utc=utc_now_iso())
        with self._lock:
            self._conn.execute(
                "INSERT INTO org_memory (id, payload) VALUES (1, ?) "
                "ON CONFLICT(id) DO UPDATE SET payload = excluded.payload",
                (json.dumps(org.to_dict(), ensure_ascii=False),),
            )
            self._conn.commit()
        return org

    # --- 决策日志 -------------------------------------------------------

    def save_decision(self, decision: Decision) -> Decision:
        with self._lock:
            self._conn.execute(
                "INSERT INTO decisions (id, status, tags, created_at, updated_at, payload) "
                "VALUES (?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET status=excluded.status, tags=excluded.tags, "
                "updated_at=excluded.updated_at, payload=excluded.payload",
                (
                    decision.id,
                    decision.status,
                    json.dumps(list(decision.tags), ensure_ascii=False),
                    decision.created_at_utc,
                    decision.updated_at_utc,
                    json.dumps(decision.to_dict(), ensure_ascii=False),
                ),
            )
            self._conn.commit()
        return decision

    def get_decision(self, decision_id: str) -> Decision:
        row = self._conn.execute(
            "SELECT payload FROM decisions WHERE id = ?", (decision_id,)
        ).fetchone()
        if row is None:
            raise NotFoundError("decision_not_found", "没有找到这条决策。")
        return _to_decision(json.loads(row["payload"]))

    def list_decisions(
        self, *, tag: str | None = None, status: str | None = None
    ) -> list[Decision]:
        rows = self._conn.execute(
            "SELECT payload, tags FROM decisions ORDER BY created_at DESC"
        ).fetchall()
        out: list[Decision] = []
        for row in rows:
            decision = _to_decision(json.loads(row["payload"]))
            if status and decision.status != status:
                continue
            if tag and tag not in decision.tags:
                continue
            out.append(decision)
        return out

    def recent_decisions(
        self, n: int = 5, *, statuses: tuple[str, ...] = ("decided", "reviewed")
    ) -> tuple[Decision, ...]:
        rows = self._conn.execute(
            "SELECT payload FROM decisions ORDER BY updated_at DESC"
        ).fetchall()
        out: list[Decision] = []
        for row in rows:
            decision = _to_decision(json.loads(row["payload"]))
            if decision.status in statuses:
                out.append(decision)
            if len(out) >= n:
                break
        return tuple(out)

    def update_decision(self, decision_id: str, changes: dict[str, Any]) -> Decision:
        current = self.get_decision(decision_id)
        allowed = {
            "title", "context", "options_considered", "chosen", "rationale",
            "expectation", "tags", "status", "decision_map",
        }
        patch: dict[str, Any] = {}
        for key, value in changes.items():
            if key not in allowed or value is None:
                continue
            if key in {"options_considered", "tags"}:
                patch[key] = tuple(value)
            else:
                patch[key] = value
        updated = replace(current, updated_at_utc=utc_now_iso(), **patch)
        return self.save_decision(updated)

    def review_decision(self, decision_id: str, review_outcome: str) -> Decision:
        current = self.get_decision(decision_id)
        now = utc_now_iso()
        updated = replace(
            current,
            review_outcome=review_outcome,
            status="reviewed",
            reviewed_at_utc=now,
            updated_at_utc=now,
        )
        return self.save_decision(updated)

    # --- 圆桌会话 -------------------------------------------------------

    def save_council_session(self, session: CouncilSession) -> CouncilSession:
        with self._lock:
            self._conn.execute(
                "INSERT INTO council_sessions (id, created_at, payload) VALUES (?, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
                (session.id, session.created_at_utc, json.dumps(session.to_dict(), ensure_ascii=False)),
            )
            self._conn.commit()
        return session

    def get_council_session(self, session_id: str) -> dict[str, Any]:
        row = self._conn.execute(
            "SELECT payload FROM council_sessions WHERE id = ?", (session_id,)
        ).fetchone()
        if row is None:
            raise NotFoundError("council_session_not_found", "没有找到这次圆桌记录。")
        return json.loads(row["payload"])

    # --- 单聊会话 -------------------------------------------------------

    def get_or_create_chat_session(self, session_id: str | None, advisor_id: str) -> ChatSession:
        if session_id:
            row = self._conn.execute(
                "SELECT payload FROM chat_sessions WHERE id = ?", (session_id,)
            ).fetchone()
            if row is not None:
                existing = _to_chat_session(json.loads(row["payload"]))
                if existing.advisor_id == advisor_id:
                    return existing
        now = utc_now_iso()
        return ChatSession(
            session_id=session_id or f"chat_{uuid4().hex}",
            advisor_id=advisor_id,
            messages=(),
            created_at_utc=now,
            updated_at_utc=now,
        )

    def save_chat_session(self, session: ChatSession) -> ChatSession:
        with self._lock:
            self._conn.execute(
                "INSERT INTO chat_sessions (id, advisor_id, updated_at, payload) VALUES (?, ?, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET advisor_id=excluded.advisor_id, "
                "updated_at=excluded.updated_at, payload=excluded.payload",
                (
                    session.session_id,
                    session.advisor_id,
                    session.updated_at_utc,
                    json.dumps(session.to_dict(), ensure_ascii=False),
                ),
            )
            self._conn.commit()
        return session

    def get_chat_session(self, session_id: str) -> ChatSession:
        row = self._conn.execute(
            "SELECT payload FROM chat_sessions WHERE id = ?", (session_id,)
        ).fetchone()
        if row is None:
            raise NotFoundError("chat_session_not_found", "没有找到这次单聊会话。")
        return _to_chat_session(json.loads(row["payload"]))

    def close(self) -> None:
        self._conn.close()


# --- dict → dataclass 重建 ----------------------------------------------

def _to_org_memory(payload: dict[str, Any]) -> OrgMemory:
    return OrgMemory(
        mission=payload.get("mission", ""),
        values=tuple(payload.get("values") or ()),
        audience=tuple(payload.get("audience") or ()),
        product_lines=tuple(payload.get("product_lines") or ()),
        constraints=tuple(payload.get("constraints") or ()),
        voice_and_taste=payload.get("voice_and_taste", ""),
        updated_at_utc=payload.get("updated_at_utc", utc_now_iso()),
    )


def _to_decision(payload: dict[str, Any]) -> Decision:
    data = dict(payload)
    data["options_considered"] = tuple(data.get("options_considered") or ())
    data["tags"] = tuple(data.get("tags") or ())
    data.setdefault("decision_map", None)
    return Decision(**data)


def _to_chat_session(payload: dict[str, Any]) -> ChatSession:
    messages = tuple(
        ChatMessage(
            role=m["role"],
            content=m["content"],
            created_at_utc=m["created_at_utc"],
            citations=tuple(m.get("citations") or ()),
        )
        for m in payload.get("messages", [])
    )
    return ChatSession(
        session_id=payload["session_id"],
        advisor_id=payload["advisor_id"],
        messages=messages,
        created_at_utc=payload["created_at_utc"],
        updated_at_utc=payload["updated_at_utc"],
    )
