#!/usr/bin/env python3
"""PreToolUse guard for Bash commands.

Blocks commands that are destructive, bypass review, or leak secrets.
Exit code 2 = block; the stderr message is shown to Claude.

These are guardrails, not walls: the real wall is CI + branch protection on GitHub.
Changing this file requires explicit approval from the project owner.
"""
import json
import re
import sys

RULES = [
    # (pattern, message)
    (r"\bgit\s+push\b[^\n;&|]*[\s:+](main|master)(\s|$|[;&|])",
     "Direct push to main/master is forbidden. Push a feature branch and open a PR."),
    (r"\bgit\s+push\b[^\n;&|]*(\s--force(?!-with-lease)\b|\s-f\b)",
     "Force push is forbidden (use --force-with-lease only on your own branch, with owner approval)."),
    (r"\bgit\s+reset\s+--hard\b",
     "git reset --hard destroys work. Use git stash or a new branch instead."),
    (r"\bgit\s+clean\s+-[a-zA-Z]*f",
     "git clean -f deletes untracked files permanently. Ask the owner first."),
    (r"--no-verify\b",
     "--no-verify skips safety hooks. Fix the failing check instead."),
    (r"\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r|-r\s+-f|-f\s+-r|--recursive\s+--force|--force\s+--recursive)\b",
     "rm -rf is blocked. Delete specific files explicitly, or ask the owner."),
    (r"\b(curl|wget)\b[^\n]*\|\s*(ba|z)?sh\b",
     "Piping a download into a shell is blocked (supply-chain risk)."),
    (r"\bsudo\b", "sudo is blocked."),
    (r"\bprisma\s+migrate\s+reset\b|\bprisma\s+db\s+push\b[^\n]*--(force-reset|accept-data-loss)",
     "Destructive database command blocked. Write a proper migration; ask the owner before any data loss."),
    (r"\b(DROP\s+(TABLE|DATABASE|SCHEMA)|TRUNCATE\s+TABLE?)\b",
     "Destructive SQL blocked. Use a reviewed migration; ask the owner."),
    (r"\b(npm|yarn)\s+(i|install|add)\b",
     "This project uses pnpm only. Use `pnpm add <pkg>@<exact-version>` and justify every new dependency."),
    (r"(^|[\s'\"=/])\.env(\.(?!example\b)[\w.-]+)?(\s|$|['\"])",
     "Access to .env files is blocked (secrets). Use .env.example for documentation."),
    (r"\b(printenv|env)\s*($|\|)",
     "Dumping the environment can leak secrets. Read a specific non-secret variable instead."),
    (r"guardrail-canary",
     "Canary OK: guardrail hooks are active in this session."),
    (r"\.claude/(settings(\.local)?\.json|hooks/)|\.github/|CLAUDE\.md|docs/specs/approved/|"
     r"\.claude/settings[\w.]*\.json|disableAllHooks|core\.hooksPath",
     "Guardrail files (.claude/settings*.json, .claude/hooks/, .github/, CLAUDE.md, approved specs, "
     "~/.claude) may only be changed by the owner. Stop and ask."),
    (r"\bgh\s+(pr\s+merge|repo\s+(delete|edit)|api\b[^\n]*(protection|rulesets|-X\s*(DELETE|PUT|PATCH)|--method\s+(DELETE|PUT|PATCH)))",
     "Merging PRs, deleting/editing the repo or changing branch protection is the owner's job only."),
    (r"\bvercel\b[^\n]*(--prod\b|\bpromote\b|\benv\b)|\bprisma\s+migrate\s+deploy\b",
     "Production deploys, production env vars and production migrations run only from CI after the owner merges."),
    (r"\bgit\s+push\b[^\n]*(--mirror|--delete|--all\b)",
     "Mirror/delete/all pushes are blocked."),
]

# Read-only commands may touch guardrail paths (cat/ls/grep/git diff etc.).
READ_ONLY_PREFIX = re.compile(r"^\s*(cat|less|head|tail|ls|grep|rg|git\s+(diff|log|show|status)|wc|python3\s+-m\s+json\.tool)\b")
# Read-only git commands that merely mention a guarded path are allowed.
GUARDED_PATH_RULE = "Guardrail files"


def main() -> int:
    try:
        data = json.load(sys.stdin)
    except Exception:
        return 0
    cmd = (data.get("tool_input") or {}).get("command") or ""
    if not cmd:
        return 0
    for pattern, message in RULES:
        if re.search(pattern, cmd, flags=re.IGNORECASE):
            if GUARDED_PATH_RULE in message and READ_ONLY_PREFIX.match(cmd) and not re.search(r"[>|;&]", cmd):
                continue
            if GUARDED_PATH_RULE in message and re.match(r"^\s*git\s+(add|commit)\b", cmd) and not re.search(r"[>|;&]", cmd):
                continue  # committing is fine; the edit itself is what is guarded, and CI/CODEOWNERS see it
            print(f"BLOCKED by project guardrail: {message}\nCommand: {cmd[:300]}", file=sys.stderr)
            return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
