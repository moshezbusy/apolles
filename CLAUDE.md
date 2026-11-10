# Apolles — rules for AI agents (read fully before any action)

Apolles is a B2B hotel booking platform for travel agents. Money, personal data and real
bookings are involved: a bug can double-charge, double-book or leak data. Slow and correct
beats fast and wrong. The owner (Moshe) is not a programmer: explain decisions in plain words.

## 0. Owner decisions (locked — change only if the owner says so in chat)

- **One supplier: Expedia Rapid API.** No TBO, no other supplier, no hotel mapping. Keep the
  supplier behind one adapter interface, but build and test only the Expedia adapter.
- **Two user types only: Admin and Agent.** No other roles, no client accounts, no sub-users.
- **Scope = the approved spec** in `docs/specs/approved/`. Nothing outside it gets built.
  If something seems missing, ask; do not add it. The old plan in `_bmad-output/` and `_bmad/`
  is superseded history: never follow it.
- **Session check first.** Before any change, run `echo guardrail-canary`. It MUST be blocked.
  If it runs, the guardrails are off in this session: stop and tell the owner.
- **No live credentials, ever.** Agents work only with Expedia test credentials, payment test
  mode and non-production databases. Live keys and the production database URL exist only in
  the hosting provider, set by the owner. If you see a live key, stop and tell the owner.
- **Agent PRs merge automatically; production deploy is the owner's action.** A PR from a `claude/` branch merges into `main` by itself once every CI check is green (`.github/workflows/auto-merge.yml`, owner decision 2026-11-10), and staging follows `main` within 5 minutes. Agents never merge by hand and never push to `main`.

## 1. Workflow — mandatory, in this order

1. **Understand before touching.** Read every file you will change *in full*, plus its callers
   (`grep` for usages) and related tests. Search for an existing helper/pattern before writing
   a new one. Never edit a file you have not read in this session.
2. **Plan.** New feature or behavior change → `brainstorming` skill, then `writing-plans`.
   Small, scoped tasks. Ask the owner when a decision is a product decision.
3. **Test first.** `test-driven-development`: failing test → minimal code → green → refactor.
4. **Bugs.** `systematic-debugging`: find the root cause before proposing a fix. No guessing.
5. **Verify.** `verification-before-completion`: run typecheck, lint, tests and build and read
   the output before saying "done". Report failures honestly, with the output.
6. **Review.** `requesting-code-review` for every change. For anything touching auth, payments,
   bookings, pricing, PII, or supplier APIs also run `differential-review` and `/security-review`.
7. **Ship via PR only.** Feature branch → PR → CI green → auto-merge. Never push to `main`. Nobody reviews after the PR is opened, so steps 5 and 6 (verify, review) must be done before it.

Skill references written as `superpowers:<name>` mean the skill `<name>` in `.claude/skills/`.
Vendored skills are pinned and read-only (see `.claude/skills/THIRD_PARTY.md`); add project
skills as `.claude/skills/project-<name>/`.

## 2. Security non-negotiables

- **Never trust the client.** Recompute price, availability and markup on the server; re-check
  the rate with the supplier immediately before booking. Client-sent prices are ignored.
- **AuthZ on every entry point.** Every server action / route handler checks the session, the
  role, *and* that the record belongs to the caller's agency (no IDOR). Scope every DB query by
  `agencyId`. Deny by default.
- **Validate all input** with Zod at the boundary (forms, server actions, webhooks, supplier
  responses). Reject unknown fields.
- **Idempotency.** Booking creation and payment take an idempotency key; a retry must never create
  a second booking or charge. If a supplier call times out after "book", mark the booking
  `PENDING_CONFIRMATION` and reconcile — never blindly rebook.
- **Money** is stored as integer minor units (or `Decimal`) + ISO currency. Never `float`.
- **Payments:** never store, log or transmit raw card data; use the payment provider's
  tokens/hosted fields only.
- **Secrets** live in environment variables only, never in code, logs or `NEXT_PUBLIC_*`.
  Never read or print `.env*`. Document variables in `.env.example`.
- **Logs** contain no passwords, tokens, card data or full passport/ID numbers.
- **Auth:** hashed passwords (argon2/bcrypt), rate-limited login, secure httpOnly cookies,
  CSRF-safe mutations, session invalidation on deactivate.
- **Dependencies:** pnpm only, exact versions, justify each new package; run the
  `supply-chain-risk-auditor` skill before adding anything non-trivial.

## 3. Scalability & consistency rules

- Stateless app servers; no in-memory state that must survive a request.
- Every list endpoint is paginated; every query pattern has a matching DB index; no N+1 queries.
- Supplier calls have timeouts and are isolated behind adapters (one adapter per supplier,
  one normalized model).
- Booking status is an explicit state machine; transitions happen inside a DB transaction and
  write an audit-log row.
- Follow the approved spec and its architecture section for stack, layering and naming.
  Layering: UI → server actions → services → adapters / DB. No DB access from UI code.
- Match existing patterns and naming. Consistency beats personal preference.

## 4. Guardrails (do not weaken)

- `.claude/settings.json` + `.claude/hooks/` block dangerous commands, secret access, edits to
  guardrails (incl. this file and approved specs), merging, production deploys, and GitHub API
  writes to main; and stop a turn while typecheck/lint/tests fail.
- `.github/workflows/guardrails.yml` runs secret scanning (gitleaks), SAST (semgrep), dependency
  audit, typecheck, lint, tests and build on every PR.
- Changing any guardrail file requires the owner's explicit approval in chat. If a guardrail
  blocks you, stop and explain — do not look for a workaround.
- `package.json` must declare `packageManager` (pnpm) and the scripts `typecheck`, `lint`,
  `test`, `build`.

## 5. Definition of done

Tests written first and passing · typecheck/lint/build clean · security rules above checked ·
code reviewed · CI green · owner told, in plain words, what changed and what was *not* verified.
