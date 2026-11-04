#!/usr/bin/env python3
"""PreToolUse guard for GitHub MCP tools.

The GitHub MCP tools can change the repository without git, so they get the
same limits as the shell: no merging, no auto-merge, no writes to main.
Exit code 2 = block; stderr is shown to Claude.
Changing this file requires explicit approval from the project owner.
"""
import json
import re
import sys

ALWAYS_BLOCKED = {
    "mcp__github__merge_pull_request": "Merging is the owner's job only.",
    "mcp__github__enable_pr_auto_merge": "Auto-merge is not allowed; the owner merges by hand.",
    "mcp__github__create_repository": "Creating repositories is not allowed.",
    "mcp__github__fork_repository": "Forking is not allowed.",
    "mcp__github__actions_run_trigger": "Triggering, cancelling or re-running workflows is the owner's job.",
    "mcp__github__pull_request_review_write": "Agents do not approve PRs; reviews are written as comments only.",
}
WRITE_TOOLS = {
    "mcp__github__push_files",
    "mcp__github__create_or_update_file",
    "mcp__github__delete_file",
    "mcp__github__update_pull_request_branch",
}
GUARDED_PATH = re.compile(r"(^|/)(\.github/|\.claude/(settings|hooks)|CLAUDE\.md$|docs/specs/approved/)")


def block(msg: str) -> int:
    print(f"BLOCKED by project guardrail: {msg}", file=sys.stderr)
    return 2


def main() -> int:
    try:
        data = json.load(sys.stdin)
    except Exception:
        return 0
    tool = data.get("tool_name") or ""
    ti = data.get("tool_input") or {}
    if tool in ALWAYS_BLOCKED:
        return block(ALWAYS_BLOCKED[tool])
    if tool in WRITE_TOOLS:
        branch = str(ti.get("branch") or "")
        if branch in ("", "main", "master"):
            return block("Writes through the GitHub API must name a feature branch, never main/master.")
        paths = [str(ti.get("path") or "")] + [str(f.get("path", "")) for f in (ti.get("files") or []) if isinstance(f, dict)]
        if any(GUARDED_PATH.search(p) for p in paths if p):
            return block("Guardrail files may only be changed by the owner.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
