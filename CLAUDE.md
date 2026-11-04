# Apolles — rules for AI agents (read fully before any action)

Apolles is a B2B hotel booking platform for travel agents. Money, personal data and real
bookings are involved: a bug can double-charge, double-book or leak data. Slow and correct
beats fast and wrong. The owner (Moshe) is not a programmer: explain decisions in plain words.

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
7. **Ship via PR only.** Feature branch → PR → CI green → owner merges. Never push to `main`.

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
- Follow `_bmad-output/planning-artifacts/architecture.md` for stack, layering and naming.
  Layering: UI → server actions → services → adapters / DB. No DB access from UI code.
- Match existing patterns and naming. Consistency beats personal preference.

## 4. Guardrails (do not weaken)

- `.claude/settings.json` + `.claude/hooks/` block dangerous commands, secret access, edits to
  guardrails, and stop a turn while typecheck/lint/tests fail.
- `.github/workflows/guardrails.yml` runs secret scanning (gitleaks), SAST (semgrep), dependency
  audit, typecheck, lint, tests and build on every PR.
- Changing any guardrail file requires the owner's explicit approval in chat. If a guardrail
  blocks you, stop and explain — do not look for a workaround.
- `package.json` must declare `packageManager` (pnpm) and the scripts `typecheck`, `lint`,
  `test`, `build`.

## 5. Definition of done

Tests written first and passing · typecheck/lint/build clean · security rules above checked ·
code reviewed · CI green · owner told, in plain words, what changed and what was *not* verified.
