"""决策内阁 Web/App API（FastAPI）。"""
from __future__ import annotations

import json
import hmac
import ipaddress
import logging
import os
import queue
import threading
from typing import Annotated, Any, Literal
from uuid import uuid4

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field, StringConstraints, model_validator

from . import context, council, decision_map
from .advisors import AdvisorNotFoundError, load_advisor, load_all_advisors
from .knowledge import get_knowledge_card, knowledge_stats, load_all_knowledge, search_knowledge
from .providers import get_provider, provider_status
from .schema import ChatMessage, FactSheet, OrgMemory, utc_now_iso
from .store import CabinetStore, NotFoundError
from .version import VERSION

logger = logging.getLogger(__name__)

_DEFAULT_UI_ORIGINS = (
    "http://localhost:5173",
    "http://127.0.0.1:5173",
)
_SSE_HEARTBEAT_SECONDS = 15.0


# --- 请求模型 -----------------------------------------------------------

ShortText = Annotated[str, StringConstraints(max_length=500)]
LongText = Annotated[str, StringConstraints(max_length=12000)]
TranscriptText = Annotated[str, StringConstraints(max_length=council.MAX_TRANSCRIPT_CONTENT_CHARS)]

class FactSheetIn(BaseModel):
    facts: list[ShortText] = Field(default_factory=list, max_length=50)
    assumptions: list[ShortText] = Field(default_factory=list, max_length=50)
    unknowns: list[ShortText] = Field(default_factory=list, max_length=50)
    evidence_gaps: list[ShortText] = Field(default_factory=list, max_length=50)

    def to_factsheet(self) -> FactSheet:
        return FactSheet(
            facts=tuple(self.facts),
            assumptions=tuple(self.assumptions),
            unknowns=tuple(self.unknowns),
            evidence_gaps=tuple(self.evidence_gaps),
        )


class FactsheetRequest(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    depth: str = "standard"
    provider: str | None = None
    include_memory: bool = False


class ClarifyRequest(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    depth: str = "standard"
    provider: str | None = None
    include_memory: bool = False


class DecisionMapRequest(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    depth: str = "standard"
    provider: str | None = None
    background: str = Field(default="", max_length=30000)
    include_memory: bool = False


class ClarifyAnswerIn(BaseModel):
    q: ShortText
    a: LongText = ""


class DeliberateRequest(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    advisor_ids: list[ShortText] | None = Field(default=None, max_length=16)
    depth: str = "standard"
    provider: str | None = None
    fact_sheet: FactSheetIn | None = None
    clarifications: list[ClarifyAnswerIn] | None = Field(default=None, max_length=20)
    include_memory: bool = False

    def background(self) -> str:
        if not self.clarifications:
            return ""
        return council.format_background(tuple((c.q, c.a) for c in self.clarifications))


class TranscriptEntryIn(BaseModel):
    round: int = 0
    role: Literal["advisor", "founder", "facilitator"] = "advisor"
    speaker_id: ShortText = ""
    speaker_name: ShortText = ""
    content: TranscriptText = ""
    entry_id: ShortText = ""
    reply_to_id: ShortText = ""
    reply_to_name: ShortText = ""
    reply_excerpt: ShortText = ""
    stance: Literal["propose", "support", "challenge", "refine", "abstain", "synthesize"] = "propose"
    novelty: Literal["new", "refined", "low"] = "new"
    participation_mode: Literal["", "answer", "add", "focus", "listen"] = ""
    delta_type: Literal[
        "claim", "new_evidence", "counterexample", "condition",
        "position_change", "evidence_request", "none",
    ] = "claim"
    delta: ShortText = ""


class RoundPositionIn(BaseModel):
    speaker_id: ShortText = ""
    speaker_name: ShortText = ""
    claim: str = Field(default="", max_length=2000)
    stance: ShortText = "propose"
    responds_to_name: ShortText = ""
    responds_to_id: ShortText = ""
    role: Literal["advisor", "founder"] = "advisor"


class RoundSummaryIn(BaseModel):
    round: int = Field(ge=1, le=4)
    phase: Literal["facts", "debate", "stress_test", "convergence"]
    title: ShortText
    topics: list[ShortText] = Field(default_factory=list, max_length=10)
    positions: list[RoundPositionIn] = Field(default_factory=list, max_length=council.MAX_ROUND_ADVISORS + 1)
    provisional_conclusions: list[ShortText] = Field(default_factory=list, max_length=12)
    consensus: list[ShortText] = Field(default_factory=list, max_length=12)
    dissents: list[ShortText] = Field(default_factory=list, max_length=12)
    questions_for_user: list[ShortText] = Field(default_factory=list, max_length=8)
    next_round_focus: list[ShortText] = Field(default_factory=list, max_length=8)
    created_at_utc: ShortText = ""


class ParticipationIn(BaseModel):
    mode: Literal["answer", "add", "focus", "listen"] = "listen"
    content: str = Field(default="", max_length=4000)
    reply_to_id: ShortText = ""
    reply_to_name: ShortText = ""
    reply_excerpt: ShortText = ""

    @model_validator(mode="after")
    def text_required_for_active_modes(self):
        if self.mode != "listen" and not self.content.strip():
            raise ValueError("回答、补充或指定争议时必须填写内容。")
        return self


class OptionMapIn(BaseModel):
    name: str = Field(max_length=240)
    gains: list[ShortText] = Field(default_factory=list, max_length=20)
    direct_costs: list[ShortText] = Field(default_factory=list, max_length=20)
    opportunity_costs: list[ShortText] = Field(default_factory=list, max_length=20)
    risks: list[ShortText] = Field(default_factory=list, max_length=20)
    second_order_effects: list[ShortText] = Field(default_factory=list, max_length=20)
    reversibility: str = Field(default="", max_length=2000)


class EvolutionPathIn(BaseModel):
    name: str = Field(max_length=240)
    trigger: str = Field(default="", max_length=2000)
    near_term: str = Field(default="", max_length=2000)
    medium_term: str = Field(default="", max_length=2000)
    leading_signals: list[ShortText] = Field(default_factory=list, max_length=20)
    response: str = Field(default="", max_length=2000)


class DecisionMapIn(BaseModel):
    decision_type: str = Field(default="mixed", max_length=32)
    core_question: str = Field(default="", max_length=4000)
    objective: str = Field(default="", max_length=4000)
    constraints: list[ShortText] = Field(default_factory=list, max_length=30)
    stakeholders: list[ShortText] = Field(default_factory=list, max_length=30)
    options: list[OptionMapIn] = Field(default_factory=list, max_length=decision_map.MAX_OPTIONS)
    tensions: list[ShortText] = Field(default_factory=list, max_length=30)
    yin_yang_cycles: list[ShortText] = Field(default_factory=list, max_length=30)
    evolution_paths: list[EvolutionPathIn] = Field(default_factory=list, max_length=decision_map.MAX_EVOLUTION_PATHS)
    evidence_to_collect: list[ShortText] = Field(default_factory=list, max_length=40)
    stop_conditions: list[ShortText] = Field(default_factory=list, max_length=40)
    knowledge_ids: list[ShortText] = Field(default_factory=list, max_length=50)
    confidence_note: str = Field(default="", max_length=4000)
    data_as_of: ShortText = ""
    source_urls: list[ShortText] = Field(default_factory=list, max_length=50)
    facts: list[ShortText] = Field(default_factory=list, max_length=50)
    inferences: list[ShortText] = Field(default_factory=list, max_length=50)


class RoundRequest(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    depth: str = "standard"
    provider: str | None = None
    advisor_ids: list[ShortText] | None = Field(default=None, max_length=16)
    background: str = Field(default="", max_length=20000)
    transcript: list[TranscriptEntryIn] = Field(default_factory=list, max_length=100)
    summaries: list[RoundSummaryIn] = Field(default_factory=list, max_length=4)
    participation: ParticipationIn = Field(default_factory=ParticipationIn)
    round_index: int = Field(default=1, ge=1, le=4)
    include_memory: bool = False

    @model_validator(mode="after")
    def bounded_prompt(self):
        if self.advisor_ids and len(set(self.advisor_ids)) != len(self.advisor_ids):
            raise ValueError("参会顾问不得重复。")
        summary_rounds = [item.round for item in self.summaries]
        expected_rounds = list(range(1, self.round_index))
        if summary_rounds != expected_rounds:
            raise ValueError(f"第 {self.round_index} 轮必须携带按顺序完成的前序纪要：{expected_rounds}。")
        summary_size = sum(len(item.model_dump_json()) for item in self.summaries)
        if len(self.background) + sum(len(item.content) for item in self.transcript) + summary_size > 80000:
            raise ValueError("圆桌背景与对话总长度不得超过 80000 字符。")
        return self


class CloseRequest(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    depth: str = "standard"
    provider: str | None = None
    background: str = Field(default="", max_length=20000)
    transcript: list[TranscriptEntryIn] = Field(default_factory=list, max_length=100)
    summaries: list[RoundSummaryIn] = Field(default_factory=list, max_length=4)
    decision_map: DecisionMapIn | None = None
    include_memory: bool = False

    @model_validator(mode="after")
    def bounded_prompt(self):
        summary_rounds = [item.round for item in self.summaries]
        if summary_rounds and summary_rounds != list(range(1, max(summary_rounds) + 1)):
            raise ValueError("收束前的各轮纪要必须从第 1 轮开始、按顺序且不重复。")
        summary_size = sum(len(item.model_dump_json()) for item in self.summaries)
        if len(self.background) + sum(len(item.content) for item in self.transcript) + summary_size > 80000:
            raise ValueError("收束背景与对话总长度不得超过 80000 字符。")
        return self


class ChatRequest(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    session_id: ShortText | None = None
    depth: str = "standard"
    provider: str | None = None
    include_memory: bool = False


class DecisionCreate(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    context: LongText = ""
    council_session_id: ShortText | None = None
    options_considered: list[ShortText] = Field(default_factory=list, max_length=30)
    chosen: LongText = ""
    rationale: LongText = ""
    expectation: LongText = ""
    tags: list[ShortText] = Field(default_factory=list, max_length=30)
    status: ShortText = "decided"


class DecisionPatch(BaseModel):
    title: ShortText | None = None
    context: LongText | None = None
    options_considered: list[ShortText] | None = Field(default=None, max_length=30)
    chosen: LongText | None = None
    rationale: LongText | None = None
    expectation: LongText | None = None
    tags: list[ShortText] | None = Field(default=None, max_length=30)
    status: ShortText | None = None


class ReviewRequest(BaseModel):
    review_outcome: str = Field(min_length=1, max_length=12000)


class OrgMemoryIn(BaseModel):
    mission: LongText = ""
    values: list[ShortText] = Field(default_factory=list, max_length=50)
    audience: list[ShortText] = Field(default_factory=list, max_length=50)
    product_lines: list[ShortText] = Field(default_factory=list, max_length=50)
    constraints: list[ShortText] = Field(default_factory=list, max_length=50)
    voice_and_taste: LongText = ""


# --- 应用工厂 -----------------------------------------------------------

def create_app(store: CabinetStore | None = None) -> FastAPI:
    active_store = store or CabinetStore(os.environ.get("CABINET_DB_PATH", "cabinet.db"))
    app = FastAPI(
        title="决策内阁 API",
        version=VERSION,
        description="开源 AI 决策支持系统：决策地图、可追溯知识库、多轮私董会、决策日志与复盘。",
    )
    sse_slots = threading.BoundedSemaphore(value=2)
    allowed_ui_origins = _allowed_ui_origins()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(allowed_ui_origins),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def protect_private_local_api(request: Request, call_next):
        """私有 UI API 默认只接受本机请求；远程访问必须携带 API key。"""
        path = request.url.path
        if not path.startswith("/api/") or path.startswith("/api/v1/"):
            return await call_next(request)
        if request.headers.get("sec-fetch-site", "").lower() == "cross-site":
            return JSONResponse(
                status_code=403,
                content={"detail": {"code": "cross_site_blocked", "message": "拒绝跨站访问本地决策数据。"}},
            )
        origin = request.headers.get("origin", "").rstrip("/")
        host_origin = f"{request.url.scheme}://{request.headers.get('host', '')}".rstrip("/")
        if origin and origin != host_origin and origin not in allowed_ui_origins:
            return JSONResponse(
                status_code=403,
                content={"detail": {"code": "untrusted_origin", "message": "这个网页来源未获准访问本地决策数据。"}},
            )
        host = request.client.host if request.client else ""
        forwarded = bool(request.headers.get("x-forwarded-for"))
        expected = os.environ.get("CABINET_UI_API_KEY") or context_env("CABINET_UI_API_KEY")
        supplied = request.headers.get("X-API-Key")
        if expected:
            if not supplied or not hmac.compare_digest(supplied, expected):
                return JSONResponse(
                    status_code=401,
                    content={"detail": {"code": "invalid_api_key", "message": "访问需要有效的 X-API-Key。"}},
                )
        elif forwarded or not _is_loopback_client(host):
            return JSONResponse(
                status_code=403,
                content={"detail": {"code": "remote_ui_disabled", "message": "私有 UI API 默认仅允许本机访问。"}},
            )
        return await call_next(request)

    @app.exception_handler(NotFoundError)
    async def _not_found_handler(_: Request, exc: NotFoundError) -> JSONResponse:
        return JSONResponse(status_code=404, content={"detail": {"code": exc.code, "message": exc.message}})

    @app.exception_handler(AdvisorNotFoundError)
    async def _advisor_not_found(_: Request, exc: AdvisorNotFoundError) -> JSONResponse:
        return JSONResponse(
            status_code=404,
            content={"detail": {"code": "advisor_not_found", "message": f"没有这位顾问：{exc}"}},
        )

    # --- 基础 ---
    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "product": "decision-cabinet"}

    @app.get("/api/product/config")
    def product_config() -> dict[str, Any]:
        return {
            "product": "决策内阁",
            "api_version": VERSION,
            "providers": provider_status(),
            "depths": ["brief", "standard", "deep"],
            "advisor_count": len(load_all_advisors()),
            "knowledge_count": len(load_all_knowledge()),
            "knowledge_domains": knowledge_stats(),
            "philosophy": "如实照见、实事求是 = 实事求是的依据 + 多元思维模型 + 对道的体会 + 决策者的善心愿心与直觉",
            "disclaimer": "本工具只用于教育与决策支持，不构成投资、法律、医疗或税务建议，不保证任何结果。",
        }

    # --- 知识库 ---
    @app.get("/api/knowledge")
    def list_knowledge(q: str = "", domain: str | None = None, limit: int = 60) -> dict[str, Any]:
        domains = (domain,) if domain else None
        cards = search_knowledge(q, domains=domains, limit=min(max(limit, 1), 100)) if q or domain else load_all_knowledge()
        return {
            "cards": [card.public_dict() for card in cards[: min(max(limit, 1), 100)]],
            "stats": knowledge_stats(),
        }

    @app.get("/api/knowledge/{card_id}")
    def get_knowledge(card_id: str) -> dict[str, Any]:
        try:
            return get_knowledge_card(card_id).public_dict()
        except KeyError:
            raise HTTPException(status_code=404, detail={"code": "knowledge_not_found", "message": "没有找到这张知识卡。"})

    # --- 顾问 ---
    @app.get("/api/advisors")
    def list_advisors() -> dict[str, Any]:
        return {"advisors": [a.public_dict() for a in load_all_advisors()]}

    @app.get("/api/advisors/{advisor_id}")
    def get_advisor(advisor_id: str) -> dict[str, Any]:
        return load_advisor(advisor_id).public_dict()

    @app.post("/api/advisors/{advisor_id}/chat")
    def chat(advisor_id: str, request: ChatRequest) -> dict[str, Any]:
        advisor = load_advisor(advisor_id)
        provider = get_provider(request.provider)
        session = active_store.get_or_create_chat_session(request.session_id, advisor_id)
        org, recent = _memory_for_request(active_store, request.include_memory)
        content, prov, model, citations = council.chat_with_advisor(
            provider, advisor, request.question, org, recent, session.messages, request.depth
        )
        now = utc_now_iso()
        session = session.append(
            ChatMessage(role="user", content=request.question, created_at_utc=now),
            ChatMessage(
                role="assistant",
                content=content,
                created_at_utc=utc_now_iso(),
                citations=tuple(c.to_dict() for c in citations),
            ),
        )
        active_store.save_chat_session(session)
        return {
            "session_id": session.session_id,
            "advisor_id": advisor_id,
            "answer": content,
            "provider": prov,
            "model": model,
            "citations": [c.to_dict() for c in citations],
            "session": session.to_dict(),
        }

    # --- 圆桌 ---
    @app.post("/api/council/clarify")
    def clarify(request: ClarifyRequest) -> dict[str, Any]:
        """厘清步：内阁在议事前反问决策者的关键问题。"""
        provider = get_provider(request.provider)
        org, recent = _memory_for_request(active_store, request.include_memory)
        digest = context.build_org_memory_digest(org, recent)
        questions = council.build_clarifying_questions(provider, request.question, digest, request.depth)
        return {"questions": [q.to_dict() for q in questions]}

    @app.post("/api/council/factsheet")
    def factsheet(request: FactsheetRequest) -> dict[str, Any]:
        provider = get_provider(request.provider)
        org, recent = _memory_for_request(active_store, request.include_memory)
        digest = context.build_org_memory_digest(org, recent)
        sheet = council.build_factsheet(provider, request.question, digest, request.depth)
        return sheet.to_dict()

    @app.post("/api/decision/map")
    def map_decision(request: DecisionMapRequest) -> dict[str, Any]:
        provider = get_provider(request.provider)
        org, recent = _memory_for_request(active_store, request.include_memory)
        grounding = council.build_grounding(
            org, recent, request.background, question=request.question
        )
        mapped = decision_map.build_decision_map(
            provider, request.question, grounding, depth=request.depth
        )
        return mapped.to_dict()

    @app.post("/api/council/deliberate")
    def deliberate(request: DeliberateRequest) -> dict[str, Any]:
        provider = get_provider(request.provider)
        org, recent = _memory_for_request(active_store, request.include_memory)
        session = council.deliberate(
            provider,
            request.question,
            org_memory=org,
            recent_decisions=recent,
            advisor_ids=tuple(request.advisor_ids) if request.advisor_ids else None,
            depth=request.depth,
            fact_sheet=request.fact_sheet.to_factsheet() if request.fact_sheet else None,
            background=request.background(),
        )
        active_store.save_council_session(session)
        decision = council.draft_decision_from_council(session)
        active_store.save_decision(decision)
        return {**session.to_dict(), "decision_id": decision.id}

    @app.get("/api/council/sessions/{session_id}")
    def get_council_session(session_id: str) -> dict[str, Any]:
        return active_store.get_council_session(session_id)

    @app.post("/api/council/round")
    def council_round(request: RoundRequest) -> StreamingResponse:
        """多轮辩论的一轮：顾问按序发言、看到全场、有来有回。SSE 逐条吐 turn。"""
        prov = get_provider(request.provider)
        org, recent = _memory_for_request(active_store, request.include_memory)
        grounding = council.build_grounding(org, recent, request.background, question=request.question)
        requested_ids = tuple(request.advisor_ids) if request.advisor_ids else council.DEFAULT_ROUND_ADVISOR_IDS
        advisors = council.route_advisors(request.question, requested_ids)
        if len(advisors) > council.MAX_ROUND_ADVISORS:
            raise HTTPException(
                status_code=422,
                detail={"code": "too_many_advisors", "message": f"每轮最多允许 {council.MAX_ROUND_ADVISORS} 位顾问。"},
            )
        known_advisors = {advisor.id: advisor for advisor in load_all_advisors()}
        transcript: list[dict[str, Any]] = []
        for entry in request.transcript:
            item = entry.model_dump()
            if entry.role == "advisor":
                known = known_advisors.get(entry.speaker_id)
                if known is None:
                    raise HTTPException(
                        status_code=422,
                        detail={"code": "unknown_transcript_advisor", "message": "历史发言包含未知顾问。"},
                    )
                item["speaker_name"] = known.name
            elif entry.role == "founder":
                item["speaker_id"], item["speaker_name"] = "founder", "我"
            else:
                item["speaker_id"], item["speaker_name"] = "facilitator", "主持人"
            transcript.append(item)
        summaries = [item.model_dump() for item in request.summaries]
        participation = request.participation.model_dump()
        transcript = council.with_user_participation(transcript, participation, request.round_index)
        agenda = council.build_round_agenda(request.round_index, summaries, participation)

        if not sse_slots.acquire(blocking=False):
            raise HTTPException(status_code=429, detail={"code": "too_many_councils", "message": "同时运行的圆桌已达上限。"})

        def produce(events: queue.Queue, cancelled: threading.Event) -> None:
            events.put(("agenda", agenda.to_dict()))
            turns = council.run_round(
                prov, request.question, advisors, grounding, transcript,
                request.round_index, request.depth,
                on_turn=lambda t: events.put(("turn", t.to_dict())),
                should_stop=cancelled.is_set,
                agenda=agenda,
                prior_summaries=summaries,
                participation=participation,
            )
            if cancelled.is_set():
                return
            summary = council.build_round_summary(
                prov,
                request.question,
                grounding,
                transcript,
                turns,
                agenda,
                request.depth,
            )
            events.put(("round_summary", summary.to_dict()))
            events.put(("done", {
                "round": request.round_index,
                "turns": [t.to_dict() for t in turns],
                "summary": summary.to_dict(),
                "next_action": "close" if request.round_index == 4 else "participate_or_listen",
            }))

        return _sse_response(produce, release_slot=sse_slots)

    @app.post("/api/council/close")
    def council_close(request: CloseRequest) -> StreamingResponse:
        """主持人收束：引导而非给答案；把决定交回决策者。"""
        prov = get_provider(request.provider)
        org, recent = _memory_for_request(active_store, request.include_memory)
        grounding = council.build_grounding(org, recent, request.background, question=request.question)
        transcript = [e.model_dump() for e in request.transcript]
        summaries = [item.model_dump() for item in request.summaries]

        if not sse_slots.acquire(blocking=False):
            raise HTTPException(status_code=429, detail={"code": "too_many_councils", "message": "同时运行的圆桌已达上限。"})

        def produce(events: queue.Queue, cancelled: threading.Event) -> None:
            entry = council.build_close(
                prov, request.question, grounding, transcript, request.depth,
                stream_handler=lambda tok: events.put(("token", tok)),
                summaries=summaries,
            )
            if cancelled.is_set():
                return
            decision = council.draft_decision_from_dialogue(
                request.question,
                entry.content,
                request.decision_map.model_dump() if request.decision_map else None,
            )
            if cancelled.is_set():
                return
            active_store.save_decision(decision)
            events.put(("done", {"close": entry.to_dict(), "decision_id": decision.id}))

        return _sse_response(produce, release_slot=sse_slots)

    # --- 决策日志 ---
    @app.post("/api/decisions")
    def create_decision(request: DecisionCreate) -> dict[str, Any]:
        from uuid import uuid4
        now = utc_now_iso()
        from .schema import Decision
        decision = Decision(
            id=f"decision_{uuid4().hex}",
            title=request.title,
            context=request.context,
            council_session_id=request.council_session_id,
            options_considered=tuple(request.options_considered),
            chosen=request.chosen,
            rationale=request.rationale,
            expectation=request.expectation,
            tags=tuple(request.tags),
            status=request.status,
            review_outcome=None,
            reviewed_at_utc=None,
            created_at_utc=now,
            updated_at_utc=now,
        )
        return active_store.save_decision(decision).to_dict()

    @app.get("/api/decisions")
    def list_decisions(tag: str | None = None, status: str | None = None) -> dict[str, Any]:
        items = active_store.list_decisions(tag=tag, status=status)
        return {"decisions": [d.to_dict() for d in items]}

    @app.get("/api/decisions/{decision_id}")
    def get_decision(decision_id: str) -> dict[str, Any]:
        return active_store.get_decision(decision_id).to_dict()

    @app.patch("/api/decisions/{decision_id}")
    def patch_decision(decision_id: str, request: DecisionPatch) -> dict[str, Any]:
        return active_store.update_decision(decision_id, request.model_dump(exclude_none=True)).to_dict()

    @app.post("/api/decisions/{decision_id}/review")
    def review_decision(decision_id: str, request: ReviewRequest) -> dict[str, Any]:
        return active_store.review_decision(decision_id, request.review_outcome).to_dict()

    # --- 组织档案 ---
    @app.get("/api/org-memory")
    def get_org_memory() -> dict[str, Any]:
        return active_store.get_org_memory().to_dict()

    @app.put("/api/org-memory")
    def put_org_memory(request: OrgMemoryIn) -> dict[str, Any]:
        org = OrgMemory(
            mission=request.mission,
            values=tuple(request.values),
            audience=tuple(request.audience),
            product_lines=tuple(request.product_lines),
            constraints=tuple(request.constraints),
            voice_and_taste=request.voice_and_taste,
            updated_at_utc=utc_now_iso(),
        )
        return active_store.save_org_memory(org).to_dict()

    # --- 对外开放 API ---
    def require_api_key(x_api_key: str | None = Header(default=None)) -> None:
        expected = (
            os.environ.get("CABINET_EXTERNAL_API_KEY")
            or context_env("CABINET_EXTERNAL_API_KEY")
            or os.environ.get("CABINET_API_KEY")
            or context_env("CABINET_API_KEY")
        )
        if not expected:
            raise HTTPException(status_code=403, detail={"code": "external_api_disabled", "message": "对外 API 未开启（未设置 CABINET_API_KEY）。"})
        if not x_api_key or not hmac.compare_digest(x_api_key, expected):
            raise HTTPException(status_code=401, detail={"code": "invalid_api_key", "message": "X-API-Key 无效。"})

    @app.post("/api/v1/council/deliberate", dependencies=[Depends(require_api_key)])
    def external_deliberate(request: DeliberateRequest) -> dict[str, Any]:
        provider = get_provider(request.provider)
        org, recent = _memory_for_request(active_store, request.include_memory)
        session = council.deliberate(
            provider,
            request.question,
            org_memory=org,
            recent_decisions=recent,
            advisor_ids=tuple(request.advisor_ids) if request.advisor_ids else None,
            depth=request.depth,
            fact_sheet=request.fact_sheet.to_factsheet() if request.fact_sheet else None,
            background=request.background(),
        )
        active_store.save_council_session(session)
        decision = council.draft_decision_from_council(session)
        active_store.save_decision(decision)
        return {**session.to_dict(), "decision_id": decision.id}

    return app


# --- SSE 事件流 ---------------------------------------------------------

def _sse(event: str, data: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _sse_response(
    produce,
    *,
    release_slot: threading.BoundedSemaphore | None = None,
    heartbeat_seconds: float = _SSE_HEARTBEAT_SECONDS,
) -> StreamingResponse:
    """通用 SSE-over-POST：在后台线程跑 produce(events)，把 (event,data) 逐条吐成 SSE。"""
    def gen():
        events: queue.Queue = queue.Queue()
        cancelled = threading.Event()

        def worker() -> None:
            try:
                produce(events, cancelled)
            except Exception:  # noqa: BLE001 - 服务端记录细节，客户端只收稳定错误
                correlation_id = uuid4().hex
                logger.exception("SSE producer failed (correlation_id=%s)", correlation_id)
                events.put(("error", {
                    "code": "council_stream_failed",
                    "message": "本轮议事未完成，请重试。",
                    "correlation_id": correlation_id,
                }))
            finally:
                events.put(None)
                if release_slot is not None:
                    release_slot.release()

        threading.Thread(target=worker, daemon=True).start()
        try:
            while True:
                try:
                    item = events.get(timeout=heartbeat_seconds)
                except queue.Empty:
                    # SSE comments keep reverse proxies from treating a slow
                    # provider call as an idle connection. They are ignored by
                    # EventSource-compatible parsers and never alter UI state.
                    yield ": keep-alive\n\n"
                    continue
                if item is None:
                    break
                event, data = item
                yield _sse(event, data)
        finally:
            cancelled.set()

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def context_env(key: str) -> str | None:
    # 与模型配置使用同一份 .env 解析。
    from .providers import _env_with_dotenv
    return _env_with_dotenv().get(key)


def _allowed_ui_origins() -> tuple[str, ...]:
    """Return exact browser origins trusted to call the private local UI API."""
    configured = os.environ.get("CABINET_UI_ORIGINS") or context_env("CABINET_UI_ORIGINS") or ""
    extras = (
        item.strip().rstrip("/")
        for item in configured.split(",")
    )
    safe_extras = (
        item for item in extras
        if item.startswith(("http://", "https://")) and "*" not in item
    )
    return tuple(dict.fromkeys((*_DEFAULT_UI_ORIGINS, *safe_extras)))


def _memory_for_request(store: CabinetStore, include_memory: bool) -> tuple[OrgMemory, tuple]:
    """默认不向外部模型发送用户档案或历史决策。"""
    if not include_memory:
        return context.DEFAULT_ORG_MEMORY, ()
    return store.get_org_memory(), store.recent_decisions()


def _is_loopback_client(host: str) -> bool:
    if host == "testclient":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False




app = create_app()
