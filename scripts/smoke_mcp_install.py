"""Smoke-test an installed Decision Cabinet MCP console script.

Run this script with the Python interpreter from the fresh environment that
contains ``decision-cabinet[mcp]``.  It exercises the same stdio protocol path
that Codex, Claude Code, DeepSeek Harness, and other MCP hosts use.
"""
from __future__ import annotations

import argparse

import anyio
from mcp.client.session import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client


EXPECTED_TOOLS = {
    "decision_cabinet_search_knowledge",
    "decision_cabinet_offline_map",
    "decision_cabinet_list_advisors",
    "decision_cabinet_four_round_protocol",
    "decision_cabinet_prepare_turn",
}


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Verify an installed Decision Cabinet MCP stdio server."
    )
    parser.add_argument(
        "--command",
        default="decision-cabinet-mcp",
        help="Installed decision-cabinet-mcp executable to launch.",
    )
    return parser


async def _exercise(command: str) -> None:
    params = StdioServerParameters(command=command, args=[])
    async with stdio_client(params) as streams:
        async with ClientSession(*streams) as session:
            initialized = await session.initialize()
            if initialized.server_info.name != "Decision Cabinet":
                raise RuntimeError(
                    f"unexpected server name: {initialized.server_info.name!r}"
                )
            if initialized.server_info.version != "0.4.0":
                raise RuntimeError(
                    f"unexpected server version: {initialized.server_info.version!r}"
                )

            listed = await session.list_tools()
            names = {tool.name for tool in listed.tools}
            if names != EXPECTED_TOOLS:
                raise RuntimeError(
                    f"unexpected tool set: missing={EXPECTED_TOOLS - names}, "
                    f"extra={names - EXPECTED_TOOLS}"
                )

            result = await session.call_tool(
                "decision_cabinet_four_round_protocol",
                {},
            )
            if result.is_error or not result.content:
                raise RuntimeError("four-round protocol tool call failed")

    print(
        "Decision Cabinet MCP smoke test passed: "
        "version 0.4.0, 5 tools, protocol call successful."
    )


def main() -> None:
    args = _parser().parse_args()
    anyio.run(_exercise, args.command)


if __name__ == "__main__":
    main()
