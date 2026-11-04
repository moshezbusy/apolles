#!/usr/bin/env python3
"""PreToolUse guard for Edit/Write/NotebookEdit.

Blocks writes to secret files and to the guardrails themselves.
Exit code 2 = block; stderr is shown to Claude.
Changing this file requires explicit approval from the project owner.
"""
import json
import re
import sys

BLOCKED = [
    (r"(^|/)\.env(\.(?!example$)[^/]+)?$",
     "Writing .env files is blocked (secrets). Document variables in .env.example only."),
    (r"(^|/)\.claude/settings(\.local)?\.json$|(^|/)\.claude/hooks/|^/root/\.claude/|/home/[^/]+/\.claude/|^~/\.claude/",
     "Guardrail config may only be changed by the owner. Stop and ask."),
    (r"(^|/)\.github/",
     "CI / CODEOWNERS / Dependabot may only be changed by the owner. Stop and ask."),
    (r"(^|/)CLAUDE\.md$",
     "The project rules (CLAUDE.md) may only be changed by the owner. Propose the change in chat."),
    (r"(^|/)docs/specs/approved/",
     "Approved specs are locked. Propose a change in chat; the owner approves a new version."),
    (r"(^|/)\.claude/skills/(?!project-)[^/]+/",
     "Vendored third-party skills are pinned (see .claude/skills/THIRD_PARTY.md). "
     "Do not edit them; add a project-* skill instead."),
    (r"\.(pem|key|p12|pfx)$|(^|/)id_(rsa|ed25519)",
     "Writing key/certificate files is blocked."),
]


def main() -> int:
    try:
        data = json.load(sys.stdin)
    except Exception:
        return 0
    ti = data.get("tool_input") or {}
    path = ti.get("file_path") or ti.get("notebook_path") or ""
    if not path:
        return 0
    for pattern, message in BLOCKED:
        if re.search(pattern, path):
            print(f"BLOCKED by project guardrail: {message}\nPath: {path}", file=sys.stderr)
            return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
