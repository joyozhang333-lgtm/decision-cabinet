"""Read-only MCP surface for Decision Cabinet.

The server deliberately exposes stateless, local tools only.  It does not write
decision sessions, persist prompts, or fetch live market data.  The business
functions stay usable without the optional MCP dependency so the offline engine
and its safety boundaries can be tested in a zero-dependency installation.
"""
from __future__ import annotations

import argparse
import ipaddress
import sys
from collections.abc import Callable
from typing import Any

from .advisors import AdvisorNotFoundError, load_advisor, load_all_advisors
from .decision_map import fallback_decision_map
from .knowledge import VALID_DOMAINS, search_knowledge
from .version import VERSION

SERVER_NAME = "Decision Cabinet"
SERVER_VERSION = VERSION

_MAX_QUERY_CHARS = 4_000
_MAX_QUESTION_CHARS = 8_000
_MAX_CONTEXT_CHARS = 12_000
_PARTICIPATION_MODES = {"answer", "add", "focus", "listen"}

_ROUND_PROTOCOL: tuple[dict[str, Any], ...] = (
    {
        "round": 1,
        "phase": "facts-and-initial-positions",
        "title": "看清事实与初步立场",
        "objective": "区分事实、假设与未知，让每位顾问提出可被质疑的初步判断。",
        "required_outputs": ["小结论", "共识结论", "非共识结论", "各方初步观点"],
    },
    {
        "round": 2,
        "phase": "focused-debate",
        "title": "围绕争议点交锋",
        "objective": "把第一轮分歧变成具体议题；每位顾问必须回应、挑战或修正另一方。",
        "required_outputs": ["具体议题", "共识结论", "非共识结论", "各方明确观点"],
    },
    {
        "round": 3,
        "phase": "stress-test-and-evolution",
        "title": "压力测试与局势演化",
        "objective": "检验关键假设、代价、二阶效应与上行/基准/下行情景。",
        "required_outputs": ["被证伪的假设", "仍成立的判断", "演化信号", "需要用户补充的证据"],
    },
    {
        "round": 4,
        "phase": "convergence-and-action",
        "title": "有条件收敛",
        "objective": "形成带适用条件的结论、保留少数意见，并给出可逆下一步。",
        "required_outputs": ["条件性结论", "保留异议", "行动与停止条件", "最终由用户决定"],
    },
)


def search_decision_knowledge(
    query: str,
    domains: list[str] | tuple[str, ...] | None = None,
    limit: int = 6,
) -> dict[str, Any]:
    """Search the bundled, traceable knowledge cards without network access."""
    clean_query = _clean_text(query, _MAX_QUERY_CHARS)
    if not clean_query:
        raise ValueError("query must not be empty")
    clean_domains = tuple(dict.fromkeys(
        str(item).strip().lower()
        for item in (domains or ())
        if str(item).strip().lower() in VALID_DOMAINS
    ))
    bounded_limit = min(max(int(limit), 1), 20)
    cards = search_knowledge(
        clean_query,
        domains=clean_domains or None,
        limit=bounded_limit,
    )
    return {
        "query": clean_query,
        "domains": list(clean_domains),
        "count": len(cards),
        "results": [
            {
                "id": card.id,
                "title": card.title,
                "domain": card.domain,
                "tradition": card.tradition,
                "tags": list(card.tags),
                "summary": card.summary,
                "questions": list(card.questions),
                "method": list(card.method),
                "boundaries": list(card.boundaries),
                "sources": [
                    {
                        "label": source.label,
                        "url": source.url,
                        "source_type": source.source_type,
                    }
                    for source in card.sources
                ],
            }
            for card in cards
        ],
        "notice": "本工具只检索仓库内知识卡；来源链接需由宿主在使用时重新核验。",
    }


def build_offline_decision_map(question: str) -> dict[str, Any]:
    """Build a deterministic choice/cost/evolution map with no model or storage."""
    clean_question = _clean_text(question, _MAX_QUESTION_CHARS)
    if not clean_question:
        raise ValueError("question must not be empty")
    cards = search_knowledge(clean_question, limit=8)
    source_urls = tuple(
        source.url
        for card in cards
        for source in card.sources
        if source.url.startswith(("https://", "http://"))
    )
    decision_map = fallback_decision_map(
        clean_question,
        tuple(card.id for card in cards),
        source_urls,
    )
    return {
        "mode": "offline",
        "stored": False,
        "decision_map": decision_map.to_dict(),
        "notice": (
            "这是离线结构化草图，不包含实时行情，也不替用户作出商业、投资或人生决定。"
            "请核验原始披露、数据时点与个人风险边界。"
        ),
    }


def list_decision_advisors(
    group: str = "",
    category: str = "",
    limit: int = 60,
) -> dict[str, Any]:
    """List public advisor metadata; private prompts and guardrails are omitted."""
    wanted_group = _clean_text(group, 100).casefold()
    wanted_category = _clean_text(category, 100).lower()
    bounded_limit = min(max(int(limit), 1), 100)
    advisors = [
        advisor
        for advisor in load_all_advisors()
        if (not wanted_group or advisor.group.casefold() == wanted_group)
        and (not wanted_category or advisor.category == wanted_category)
    ][:bounded_limit]
    return {
        "count": len(advisors),
        "advisors": [advisor.public_dict() for advisor in advisors],
        "notice": "顾问是可审查的方法视角，不是对历史人物本人观点的模拟或授权代言。",
    }


def get_four_round_protocol() -> dict[str, Any]:
    """Return the public four-round deliberation and participation contract."""
    rounds = [
        {
            "round": item["round"],
            "phase": item["phase"],
            "title": item["title"],
            "objective": item["objective"],
            "required_outputs": list(item["required_outputs"]),
        }
        for item in _ROUND_PROTOCOL
    ]
    return {
        "rounds": rounds,
        "advisor_turn_contract": {
            "must_name_position": True,
            "must_respond_to_another_view_after_round_one": True,
            "allowed_stances": ["propose", "support", "challenge", "refine", "abstain"],
            "no_verbatim_repeat": True,
            "must_surface_cost_and_uncertainty": True,
        },
        "user_participation": [
            {"mode": "answer", "meaning": "回答委员会提出的问题"},
            {"mode": "add", "meaning": "主动补充事实、约束或感受"},
            {"mode": "focus", "meaning": "指定下一轮要争论的议题"},
            {"mode": "listen", "meaning": "暂不发言，让委员会继续内部讨论"},
        ],
        "decision_right": "委员会提供结构、交锋与条件性结论；最终决定权始终属于用户。",
        "stored": False,
    }


def prepare_roundtable_turn(
    question: str,
    round_index: int,
    advisor_id: str,
    prior_positions: str = "",
    user_contribution: str = "",
    participation_mode: str = "listen",
) -> dict[str, Any]:
    """Prepare one grounded speaking brief for an MCP host to turn into dialogue.

    This function does not call a model and does not persist any supplied text.
    It makes the reply relationship and novelty contract explicit so later
    rounds cannot silently repeat the first answer.
    """
    clean_question = _clean_text(question, _MAX_QUESTION_CHARS)
    if not clean_question:
        raise ValueError("question must not be empty")
    if round_index not in {1, 2, 3, 4}:
        raise ValueError("round_index must be between 1 and 4")
    clean_mode = _clean_text(participation_mode, 40).lower() or "listen"
    if clean_mode not in _PARTICIPATION_MODES:
        raise ValueError("participation_mode must be answer, add, focus, or listen")
    try:
        advisor = load_advisor(_clean_text(advisor_id, 120))
    except AdvisorNotFoundError as exc:
        raise ValueError(f"unknown advisor_id: {advisor_id}") from exc

    prior = _clean_text(prior_positions, _MAX_CONTEXT_CHARS)
    contribution = _clean_text(user_contribution, _MAX_CONTEXT_CHARS)
    agenda = _ROUND_PROTOCOL[round_index - 1]
    reply_rule = (
        "提出可被其他顾问检验的初步立场。"
        if round_index == 1 and not prior
        else "明确点名一项既有观点，并选择支持、挑战或修正；不得原样复述此前结论。"
    )
    return {
        "question": clean_question,
        "round": round_index,
        "phase": agenda["phase"],
        "agenda": {
            "title": agenda["title"],
            "objective": agenda["objective"],
            "required_outputs": list(agenda["required_outputs"]),
        },
        "advisor": {
            "id": advisor.id,
            "name": advisor.name,
            "group": advisor.group,
            "category": advisor.category,
            "lineage": advisor.lineage,
            "core_insight": advisor.core_insight,
            "lens": list(advisor.lens),
            "canon": [
                {
                    "title": ref.title,
                    "locator": ref.locator,
                    "path": ref.path,
                    "text_kind": ref.text_kind,
                }
                for ref in advisor.canon
            ],
        },
        "prior_positions": prior,
        "user_contribution": contribution,
        "participation_mode": clean_mode,
        "reply_requirement": reply_rule,
        "required_turn_fields": [
            "claim",
            "reasoning",
            "responds_to",
            "stance",
            "new_information_or_inference",
            "cost_or_tradeoff",
            "uncertainty",
            "question_for_user_if_needed",
        ],
        "host_instruction": (
            "请宿主依据以上公开视角生成一条简洁圆桌发言；区分事实与推断，"
            "不虚构实时数据或典籍原文，并让发言推进本轮议题。"
        ),
        "stored": False,
    }


def _clean_text(value: Any, max_chars: int) -> str:
    return str(value or "").strip()[:max_chars]


def _load_mcp_server_class(
    importer: Callable[..., Any] = __import__,
) -> tuple[type[Any] | None, str]:
    """Load the v2 SDK without making it a core package dependency."""
    try:
        module = importer("mcp.server", fromlist=("MCPServer",))
        server_class = getattr(module, "MCPServer")
    except (ImportError, ModuleNotFoundError, AttributeError) as exc:
        return None, f"{type(exc).__name__}: {exc}"
    return server_class, ""


def _register_tools(server: Any) -> None:
    @server.tool()
    def decision_cabinet_search_knowledge(
        query: str,
        domains: list[str] | None = None,
        limit: int = 6,
    ) -> dict[str, Any]:
        """Search local decision, business, finance, management, and wisdom cards."""
        return search_decision_knowledge(query, domains, limit)

    @server.tool()
    def decision_cabinet_offline_map(question: str) -> dict[str, Any]:
        """Create a local choice-cost-evolution map without model calls or storage."""
        return build_offline_decision_map(question)

    @server.tool()
    def decision_cabinet_list_advisors(
        group: str = "",
        category: str = "",
        limit: int = 60,
    ) -> dict[str, Any]:
        """List public advisor lenses available to an MCP host."""
        return list_decision_advisors(group, category, limit)

    @server.tool()
    def decision_cabinet_four_round_protocol() -> dict[str, Any]:
        """Explain the four-round debate and user-participation contract."""
        return get_four_round_protocol()

    @server.tool()
    def decision_cabinet_prepare_turn(
        question: str,
        round_index: int,
        advisor_id: str,
        prior_positions: str = "",
        user_contribution: str = "",
        participation_mode: str = "listen",
    ) -> dict[str, Any]:
        """Prepare a stateless advisor brief that must reply and add novelty."""
        return prepare_roundtable_turn(
            question,
            round_index,
            advisor_id,
            prior_positions,
            user_contribution,
            participation_mode,
        )


_MCPServer, _MCP_SDK_ERROR = _load_mcp_server_class()
if _MCPServer is not None:
    try:
        mcp: Any | None = _MCPServer(
            SERVER_NAME,
            description="Stateless local decision-support tools; no live market data or user-data storage.",
            version=SERVER_VERSION,
        )
        _register_tools(mcp)
    except Exception as exc:  # pragma: no cover - defensive against incompatible prereleases
        mcp = None
        _MCP_SDK_ERROR = f"{type(exc).__name__}: {exc}"
else:
    mcp = None


def _cli_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run the Decision Cabinet MCP server.")
    parser.add_argument(
        "--transport",
        choices=("stdio", "streamable-http"),
        default="stdio",
        help="MCP transport. Streamable HTTP is loopback-only and should sit behind your authenticated HTTPS proxy.",
    )
    parser.add_argument("--host", default="127.0.0.1", help="HTTP bind host; non-loopback binds are rejected.")
    parser.add_argument("--port", type=int, default=8765, help="HTTP bind port (1-65535).")
    parser.add_argument("--path", default="/mcp", help="Streamable HTTP path, beginning with '/'.")
    return parser


def _is_loopback_host(host: str) -> bool:
    if host.lower() == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _loopback_transport_security(host: str) -> Any:
    """Keep DNS-rebinding protection enabled for every accepted loopback IP."""
    from mcp.server.transport_security import TransportSecuritySettings

    normalized = host.lower()
    rendered = f"[{normalized}]" if ":" in normalized else normalized
    return TransportSecuritySettings(
        enable_dns_rebinding_protection=True,
        allowed_hosts=[rendered, f"{rendered}:*"],
        allowed_origins=[f"http://{rendered}", f"http://{rendered}:*"],
    )


def main(argv: list[str] | None = None) -> None:
    """Run the official MCP Python SDK v2 server over stdio or loopback HTTP."""
    if mcp is None:
        sys.stderr.write(
            "Decision Cabinet MCP requires the official MCP Python SDK v2 "
            "(`python3 -m pip install 'mcp>=2,<3'`). "
            f"The installed package is missing or incompatible: {_MCP_SDK_ERROR}\n"
        )
        raise SystemExit(2)
    args = _cli_parser().parse_args(argv)
    if args.transport == "stdio":
        mcp.run()
        return
    if not _is_loopback_host(args.host):
        sys.stderr.write(
            "Refusing a non-loopback MCP bind because this server has no built-in public authentication. "
            "Bind to 127.0.0.1 and place an authenticated HTTPS reverse proxy in front of it.\n"
        )
        raise SystemExit(2)
    if not 1 <= args.port <= 65535:
        sys.stderr.write("MCP port must be between 1 and 65535.\n")
        raise SystemExit(2)
    if not args.path.startswith("/"):
        sys.stderr.write("MCP Streamable HTTP path must begin with '/'.\n")
        raise SystemExit(2)
    mcp.run(
        "streamable-http",
        host=args.host,
        port=args.port,
        streamable_http_path=args.path,
        stateless_http=True,
        transport_security=_loopback_transport_security(args.host),
    )


if __name__ == "__main__":
    main()
