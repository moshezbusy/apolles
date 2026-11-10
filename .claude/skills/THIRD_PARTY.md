# Vendored third-party skills (pinned, read-only)

Copied unmodified from upstream so they work in every session (cloud sessions do not install
plugins). To update: re-copy from a newer upstream commit, review the diff, update this file.

| Skill / agent | Upstream | Pinned commit | License |
|---|---|---|---|
| using-superpowers, brainstorming, writing-plans, executing-plans, subagent-driven-development, test-driven-development, systematic-debugging, verification-before-completion, requesting-code-review, receiving-code-review | https://github.com/obra/superpowers (v7.0.0 — the commit pinned by Anthropic's official plugin marketplace) | `bb92a77741419a4ab5f06e711a283343f1ada0c3` | MIT (`_licenses/superpowers-MIT.txt`) |
| differential-review (+ agent `adversarial-modeler`), sharp-edges (+ agent `sharp-edges-analyzer`), supply-chain-risk-auditor | https://github.com/trailofbits/skills | `711af095215ad4ecde5b90cd1d0124b3f1c4ca9e` | CC BY-SA 4.0, © Trail of Bits (`_licenses/trailofbits-CC-BY-SA-4.0.txt`) |

Hook design (`.claude/hooks/`) is adapted from https://github.com/trailofbits/claude-code-config.
CI semgrep rules: https://github.com/semgrep/semgrep-rules @ `16b9e6d45f10649f6a531ec4838ed9924372c3bc`.
