#!/usr/bin/env python3
"""Start the repository MCP module without writing anything to stdout."""
from __future__ import annotations

import os
import sys
from pathlib import Path


def _repository_candidates() -> tuple[Path, ...]:
    configured = os.environ.get("DECISION_CABINET_REPO", "").strip()
    candidates: list[Path] = []
    if configured:
        candidates.append(Path(configured).expanduser())

    script_path = Path(__file__).resolve()
    # Repository layout: <repo>/plugins/decision-cabinet/scripts/run_mcp.py
    if len(script_path.parents) > 3:
        candidates.append(script_path.parents[3])
    return tuple(dict.fromkeys(path.resolve() for path in candidates))


def _bootstrap_repository() -> None:
    for candidate in _repository_candidates():
        if (candidate / "cabinet" / "mcp_server.py").is_file():
            sys.path.insert(0, str(candidate))
            return


def main() -> None:
    if sys.version_info < (3, 11):
        sys.stderr.write("Decision Cabinet MCP requires Python 3.11 or newer.\n")
        raise SystemExit(2)

    _bootstrap_repository()
    try:
        from cabinet.mcp_server import main as run_server
    except ModuleNotFoundError as exc:
        if exc.name != "cabinet":
            raise
        sys.stderr.write(
            "Decision Cabinet package was not found. Run this plugin from its repository checkout, "
            "install the decision-cabinet package, or set DECISION_CABINET_REPO to the cloned repository.\n"
        )
        raise SystemExit(2) from exc

    run_server()


if __name__ == "__main__":
    main()
