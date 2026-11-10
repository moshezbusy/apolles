#!/usr/bin/env python3
"""Stop hook: Claude may not finish a turn while typecheck / lint / tests fail.

Runs only when an app (package.json) exists and source files changed vs HEAD.
Runs the package.json scripts that exist: typecheck, lint, test.
Exit code 2 = Claude must keep working; stderr (the failure output) is shown to it.
Changing this file requires explicit approval from the project owner.
"""
import json
import os
import subprocess
import sys

CHECKS = ["typecheck", "lint", "test"]
SOURCE_EXT = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".prisma", ".json", ".css")


def run(cmd, cwd, timeout=240):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout)


def main() -> int:
    try:
        data = json.load(sys.stdin)
    except Exception:
        data = {}
    if data.get("stop_hook_active"):
        # Already forced to continue once this turn; don't loop forever.
        return 0

    root = os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()
    app_dirs = [d for d in (root, os.path.join(root, "apolles")) if os.path.isfile(os.path.join(d, "package.json"))]
    if not app_dirs:
        return 0

    try:
        changed = run(["git", "status", "--porcelain"], root, 30).stdout.splitlines()
    except Exception:
        return 0
    if not any(line.rstrip().endswith(SOURCE_EXT) for line in changed):
        return 0

    failures = []
    for app in app_dirs:
        try:
            scripts = json.load(open(os.path.join(app, "package.json"))).get("scripts", {})
        except Exception:
            continue
        for name in CHECKS:
            if name not in scripts:
                continue
            try:
                r = run(["pnpm", "-s", "run", name], app)
            except subprocess.TimeoutExpired:
                failures.append(f"[{app}] `pnpm {name}` timed out")
                continue
            except FileNotFoundError:
                return 0  # pnpm not installed here; CI will enforce
            if r.returncode != 0:
                out = (r.stdout + r.stderr)[-3000:]
                failures.append(f"[{app}] `pnpm {name}` FAILED:\n{out}")

    if failures:
        print("Quality gate failed. You are NOT done. Fix these, re-run, then report honestly:\n\n"
              + "\n\n".join(failures), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
