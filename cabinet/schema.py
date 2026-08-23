"""决策内阁核心数据模型。"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from typing import Any


def utc_now_iso() -> str:
    return datetime.now(UTC).isoformat()


class JsonMixin:
    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


# --- 溯源 ---------------------------------------------------------------

@dataclass(frozen=True)
class SourceReference(JsonMixin):
    """可溯源引用：指向包内典籍或方法摘要。"""
    kind: str            # "canon" | "method"
    code: str            # canon_id
    title: str
    path: str


@dataclass(frozen=True)
class CanonRef(JsonMixin):
    """顾问的典籍/方法论依据。原文人工录入，prompt 里作为「白名单」防杜撰。"""
    canon_id: str
    title: str
    locator: str         # 出处定位，如「般若品第二」「四圣谛·苦谛」
    quote: str           # 可直接引用的原文片段
    path: str            # cabinet/resources/canon/<advisor_id>/<canon_id>.md
    text_kind: str = "quote"  # quote | paraphrase


@dataclass(frozen=True)
class KnowledgeSource(JsonMixin):
    """知识卡的外部来源。现代方法只做摘要，原文由 URL 回溯。"""
    label: str
    url: str
    source_type: str     # primary | official | classic | research


@dataclass(frozen=True)
class KnowledgeCard(JsonMixin):
    """可检索、可追溯、带适用边界的知识单元。"""
    id: str
    title: str
    domain: str          # decision | business | finance | management | wisdom
    tradition: str       # china | international | universal
    tags: tuple[str, ...]
    summary: str
    questions: tuple[str, ...]
    method: tuple[str, ...]
    boundaries: tuple[str, ...]
    sources: tuple[KnowledgeSource, ...]
    path: str

    def public_dict(self) -> dict[str, Any]:
        return self.to_dict()


# --- 顾问 ---------------------------------------------------------------

@dataclass(frozen=True)
class Advisor(JsonMixin):
    id: str
    name: str
    category: str                       # "sage" | "expert" | "psychology" | "analyst"
    group: str                          # 展示分组（如「对道·古圣」「商业·战略」）
    lineage: str                        # 传承 / 学派 / 身份
    voice_style: str                    # 说话方式
    core_insight: str                   # 核心见地：看世界的根本视角
    lens: tuple[str, ...]               # 擅长的决策维度
    canon: tuple[CanonRef, ...]         # 典籍/方法论依据（sage 必有；目录自动归属）
    guardrails: tuple[str, ...]         # 绝不偏离 / 必须扣回什么
    path: str

    def public_dict(self) -> dict[str, Any]:
        """给前端目录用的精简视图（不外泄全部 guardrails / 全部原文）。"""
        return {
            "id": self.id,
            "name": self.name,
            "category": self.category,
            "group": self.group,
            "lineage": self.lineage,
            "core_insight": self.core_insight,
            "lens": list(self.lens),
            "canon": [
                {"title": c.title, "locator": c.locator, "path": c.path, "text_kind": c.text_kind}
                for c in self.canon
            ],
        }


# --- 实事求是步 ---------------------------------------------------------

@dataclass(frozen=True)
class ClarifyQuestion(JsonMixin):
    """厘清步：内阁在议事前反问决策者的问题。"""
    q: str
    why: str


@dataclass(frozen=True)
class FactSheet(JsonMixin):
    """如实照见：把决策拆成 已知事实 / 关键假设 / 待查证未知 / 证据缺口。"""
    facts: tuple[str, ...]
    assumptions: tuple[str, ...]
    unknowns: tuple[str, ...]
    evidence_gaps: tuple[str, ...]

    @staticmethod
    def empty() -> "FactSheet":
        return FactSheet(facts=(), assumptions=(), unknowns=(), evidence_gaps=())

    def as_text(self) -> str:
        def block(title: str, items: tuple[str, ...]) -> str:
            if not items:
                return f"{title}：（暂无）"
            return f"{title}：\n" + "\n".join(f"  - {x}" for x in items)
        return "\n".join((
            block("已知事实", self.facts),
            block("关键假设", self.assumptions),
            block("待查证的未知", self.unknowns),
            block("证据缺口", self.evidence_gaps),
        ))


# --- 决策地图 -----------------------------------------------------------

@dataclass(frozen=True)
class OptionMap(JsonMixin):
    name: str
    gains: tuple[str, ...]
    direct_costs: tuple[str, ...]
    opportunity_costs: tuple[str, ...]
    risks: tuple[str, ...]
    second_order_effects: tuple[str, ...]
    reversibility: str


@dataclass(frozen=True)
class EvolutionPath(JsonMixin):
    name: str
    trigger: str
    near_term: str
    medium_term: str
    leading_signals: tuple[str, ...]
    response: str


@dataclass(frozen=True)
class DecisionMap(JsonMixin):
    """从一个决策点展开到选择、代价、循环与局势演化。"""
    decision_type: str   # business | investment | life | mixed
    core_question: str
    objective: str
    constraints: tuple[str, ...]
    stakeholders: tuple[str, ...]
    options: tuple[OptionMap, ...]
    tensions: tuple[str, ...]
    yin_yang_cycles: tuple[str, ...]
    evolution_paths: tuple[EvolutionPath, ...]
    evidence_to_collect: tuple[str, ...]
    stop_conditions: tuple[str, ...]
    knowledge_ids: tuple[str, ...]
    confidence_note: str
    data_as_of: str = ""
    source_urls: tuple[str, ...] = ()
    facts: tuple[str, ...] = ()
    inferences: tuple[str, ...] = ()

    def as_text(self) -> str:
        rows = [
            f"决策类型：{self.decision_type}",
            f"核心问题：{self.core_question}",
            f"真正目标：{self.objective}",
        ]
        if self.data_as_of:
            rows.append(f"数据时点：{self.data_as_of}")
        if self.facts:
            rows.append("已核实事实：" + "；".join(self.facts))
        if self.inferences:
            rows.append("推断与情景假设：" + "；".join(self.inferences))
        if self.constraints:
            rows.append("约束：" + "；".join(self.constraints))
        for option in self.options:
            rows.append(
                f"方案 {option.name}｜所得：{'；'.join(option.gains) or '待核实'}｜"
                f"直接代价：{'；'.join(option.direct_costs) or '待核实'}｜"
                f"机会成本：{'；'.join(option.opportunity_costs) or '待核实'}｜"
                f"二阶效应：{'；'.join(option.second_order_effects) or '待核实'}｜"
                f"可逆性：{option.reversibility or '待判断'}"
            )
        if self.tensions:
            rows.append("核心张力：" + "；".join(self.tensions))
        if self.yin_yang_cycles:
            rows.append("阴阳循环：" + "；".join(self.yin_yang_cycles))
        for path in self.evolution_paths:
            rows.append(
                f"演化路径 {path.name}｜触发：{path.trigger}｜近期：{path.near_term}｜"
                f"中期：{path.medium_term}｜领先信号：{'；'.join(path.leading_signals)}｜应对：{path.response}"
            )
        if self.evidence_to_collect:
            rows.append("下一步证据：" + "；".join(self.evidence_to_collect))
        if self.stop_conditions:
            rows.append("停止/退出条件：" + "；".join(self.stop_conditions))
        if self.source_urls:
            rows.append("检索来源：" + "；".join(self.source_urls))
        if self.knowledge_ids:
            rows.append("知识卡：" + "；".join(self.knowledge_ids))
        rows.append("置信说明：" + self.confidence_note)
        return "\n".join(rows)


# --- 圆桌 ---------------------------------------------------------------

@dataclass(frozen=True)
class AdvisorTurn(JsonMixin):
    """圆桌发散阶段中，单位顾问的发言。"""
    advisor_id: str
    advisor_name: str
    category: str
    lineage: str
    content: str
    citations: tuple[SourceReference, ...]
    provider: str
    model: str | None
    created_at_utc: str


@dataclass(frozen=True)
class Synthesis(JsonMixin):
    """综合裁决，按决策哲学五层结构化。"""
    facts_basis: str          # ① 实事求是·事实与依据
    multi_model: str          # ② 多元思维模型·各视角思辨
    dao_view: str             # ③ 对道的体会·古圣观照
    founder_reflection: str   # ④ 回到决策者·善心愿心与直觉
    decision_and_next: str    # ⑤ 最恰当的决策与下一步
    dissents: tuple[str, ...] # 保留的异见
    raw_markdown: str         # 综合者原文（兜底展示）


@dataclass(frozen=True)
class DialogueEntry(JsonMixin):
    """多轮圆桌里的一条发言：顾问交锋 / 决策者插话 / 主持人收束。"""
    round: int
    role: str                # "advisor" | "founder" | "facilitator"
    speaker_id: str
    speaker_name: str
    lineage: str
    content: str
    citations: tuple[SourceReference, ...]
    provider: str
    model: str | None
    created_at_utc: str


@dataclass(frozen=True)
class CouncilSession(JsonMixin):
    id: str
    question: str
    fact_sheet: FactSheet
    advisor_ids: tuple[str, ...]
    turns: tuple[AdvisorTurn, ...]
    synthesis: Synthesis
    provider: str
    created_at_utc: str


# --- 单聊 ---------------------------------------------------------------

@dataclass(frozen=True)
class ChatMessage(JsonMixin):
    role: str                 # "user" | "assistant"
    content: str
    created_at_utc: str
    citations: tuple[dict[str, Any], ...] = ()


@dataclass(frozen=True)
class ChatSession(JsonMixin):
    session_id: str
    advisor_id: str
    messages: tuple[ChatMessage, ...]
    created_at_utc: str
    updated_at_utc: str

    def append(self, *messages: ChatMessage) -> "ChatSession":
        return ChatSession(
            session_id=self.session_id,
            advisor_id=self.advisor_id,
            messages=(*self.messages, *messages),
            created_at_utc=self.created_at_utc,
            updated_at_utc=utc_now_iso(),
        )


# --- 决策日志 -----------------------------------------------------------

@dataclass(frozen=True)
class Decision(JsonMixin):
    id: str
    title: str
    context: str
    council_session_id: str | None
    options_considered: tuple[str, ...]
    chosen: str
    rationale: str
    expectation: str
    tags: tuple[str, ...]
    status: str               # "draft" | "decided" | "reviewed"
    review_outcome: str | None
    reviewed_at_utc: str | None
    created_at_utc: str
    updated_at_utc: str
    decision_map: dict[str, Any] | None = None


# --- 组织记忆 -----------------------------------------------------------

@dataclass(frozen=True)
class OrgMemory(JsonMixin):
    """事业档案（单例）。每次单聊/圆桌注入，这是「越用越懂你」的底座。"""
    mission: str
    values: tuple[str, ...]
    audience: tuple[str, ...]
    product_lines: tuple[str, ...]
    constraints: tuple[str, ...]
    voice_and_taste: str
    updated_at_utc: str
