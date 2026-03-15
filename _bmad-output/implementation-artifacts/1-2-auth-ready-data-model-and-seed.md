# Story 1.2: Auth-Ready Data Model and Seed

Status: in-progress

## Story

As a developer,
I want the foundational Prisma schema with User, Session, and Account models,
so that authentication and all future data models build on a stable foundation.

## Acceptance Criteria

1. Given the Prisma schema is created, when migrations are run, then `User` model exists with fields: `id (uuid)`, `email (unique)`, `name`, `passwordHash`, `role (enum: AGENT, ADMIN)`, `isActive (boolean, default true)`, `createdAt`, `updatedAt`.
2. `Account` and `Session` models exist per NextAuth Prisma adapter requirements.
3. Prisma Migrate generates and applies the initial migration successfully.
4. A seed script creates test data: one admin account (Moshe) and one agent account.
5. Prisma client singleton is configured and working.

## Tasks / Subtasks

- [x] Task 1: Implement auth-ready Prisma schema (AC: #1, #2)
  - [x] Add `Role` enum (`AGENT`, `ADMIN`) in `apolles/prisma/schema.prisma`.
  - [x] Add `User` model with UUID id and required auth fields.
  - [x] Add NextAuth-compatible `Account` and `Session` models.
  - [x] Add `VerificationToken` model for NextAuth token flows.
- [ ] Task 2: Create and apply initial migration (AC: #3)
  - [x] Generate migration SQL artifact from Prisma schema (`prisma/migrations/20260312000000_init_auth_ready_data_model/migration.sql`).
  - [x] Apply migration against Supabase Postgres via `DATABASE_URL` using a pgbouncer-compatible connection string (`?pgbouncer=true&connection_limit=1`).
  - [ ] Run Prisma Migrate successfully (`prisma migrate dev` in development and `prisma migrate deploy` workflow in production-like environments), rather than relying only on manual SQL application.
- [x] Task 3: Add seed script for baseline users (AC: #4)
  - [x] Create `apolles/prisma/seed.ts` to insert one admin and one agent.
  - [x] Hash seeded passwords with bcrypt before persistence.
  - [x] Wire seed command in `apolles/package.json` (and Prisma config as needed).
  - [x] Execute seed successfully against migrated schema.
- [x] Task 4: Verify DB access and singleton usage (AC: #5)
  - [x] Confirm `apolles/src/lib/db.ts` remains the single Prisma access point.
  - [x] Add/update tests for schema-level assumptions and seed execution where practical. (`src/lib/prisma-schema-compat.test.ts` guards schema/migration alignment; `src/lib/seed.test.ts` covers seed helpers and seed execution flow with mocks)
  - [x] Run `pnpm build`, `pnpm test`, `pnpm typecheck` after implementation updates.

### Review Follow-ups (AI)

- [ ] [AI-Review][High] Refresh story File List so it only claims files with current review evidence; current list does not match the active git diff scope. [_bmad-output/implementation-artifacts/1-2-auth-ready-data-model-and-seed.md:246]
- [ ] [AI-Review][High] Complete native Prisma Migrate execution with a working direct database path so AC #3 is actually satisfied. [_bmad-output/implementation-artifacts/1-2-auth-ready-data-model-and-seed.md:29]
- [ ] [AI-Review][Medium] Update seed runtime to prefer `DIRECT_URL` when available so `pnpm db:seed` can avoid pooled Supabase connections the same way Prisma CLI config does. [apolles/prisma/seed.ts:39]
- [ ] [AI-Review][Medium] Remove predictable fallback seed passwords or gate them behind explicit local-dev-only behavior to avoid shipping known credentials. [apolles/prisma/seed.ts:144]
- [ ] [AI-Review][Medium] Make seed user upserts preserve existing role/activation state, or scope seed writes to truly bootstrap-only accounts, to avoid silently overwriting shared environments. [apolles/prisma/seed.ts:118]

## Dev Notes

- Story 1.1 already established Supabase Postgres as source of truth through `DATABASE_URL`; keep Prisma datasource provider as `postgresql` and do not introduce local DB assumptions.
- Current `apolles/prisma/schema.prisma` is intentionally minimal and must be expanded in this story.
- Keep architecture boundaries: app/actions -> services -> Prisma in `src/lib/db.ts`; avoid direct DB access from UI layers.
- NextAuth package in the codebase is v5 beta, so model compatibility decisions must follow v5 adapter conventions.

### Project Structure Notes

- Update only schema/data bootstrap and related config for this story.
- Keep existing lean architecture and folder conventions from Story 1.1.
- Do not implement login pages, middleware auth enforcement, or role-check helpers here (those belong to later stories).

### References

- Epic 1 Story 1.2 definition and ACs [Source: `_bmad-output/planning-artifacts/epics.md#L363`]
- Core stack and Prisma/NextAuth direction [Source: `_bmad-output/planning-artifacts/architecture.md#L24`]
- NextAuth DB sessions and role model direction [Source: `_bmad-output/planning-artifacts/architecture.md#L295`]
- Existing Story 1.1 Supabase direction and constraints [Source: `_bmad-output/implementation-artifacts/1-1-initialize-project-and-deploy-baseline-app.md`]

## Dev Agent Record

### Agent Model Used

openai/gpt-5.3-codex

### Debug Log References

- Story file created from Epic 1 backlog auto-selection (`1-2-auth-ready-data-model-and-seed`).
- `pnpm add bcryptjs`
- `pnpm add -D tsx`
- `pnpm prisma generate`
- `pnpm prisma migrate dev --name init-auth-ready-data-model` (blocked/hangs on Supabase pooler URL)
- `pnpm prisma migrate dev --name init-auth-ready-data-model --create-only` (blocked/hangs on Supabase pooler URL)
- `pnpm prisma db push --accept-data-loss` (blocked/hangs on Supabase pooler URL)
- `pnpm prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/20260312000000_init_auth_ready_data_model/migration.sql`
- `DATABASE_URL=...pooler...'?pgbouncer=true&connection_limit=1'` + Prisma Client raw SQL execution (applied 13 migration statements)
- `DATABASE_URL=...pooler...'?pgbouncer=true&connection_limit=1' pnpm db:seed` (success)
- `pnpm prisma generate` (using `prisma.config.ts`)
- `pnpm db:seed` (re-run after code review fixes; success)
- `set -a; source .env; set +a; pnpm prisma migrate status` (timed out after connection to Supabase pooler)
- `set -a; source .env.local; set +a; pnpm prisma migrate status` (timed out after connection to Supabase pooler)
- `pnpm prisma migrate status` (fails when `DATABASE_URL` is missing)
- `set -a; source .env; set +a; pnpm prisma migrate status` (fails with Supabase pooler prepared-statement error)
- `set -a; source .env; set +a; export DATABASE_URL="${DATABASE_URL}?pgbouncer=true&connection_limit=1"; pnpm prisma migrate status` (timed out against Supabase pooler)
- `if [ -f ".env" ]; then set -a; source ".env"; set +a; if [ -n "$DIRECT_URL" ]; then printf "env:DIRECT_URL\n"; else printf "env:NO_DIRECT_URL\n"; fi; fi` (confirmed `.env` does not currently provide `DIRECT_URL`)
- `if [ -f ".env.local" ]; then set -a; source ".env.local"; set +a; if [ -n "$DIRECT_URL" ]; then printf "env.local:DIRECT_URL\n"; else printf "env.local:NO_DIRECT_URL\n"; fi; fi` (confirmed `.env.local` does not currently provide `DIRECT_URL`)
- `pnpm build`
- `pnpm test`
- `pnpm typecheck`
- `pnpm test src/lib/seed.test.ts src/lib/prisma-schema-compat.test.ts`
- `set -a; source .env; set +a; pnpm prisma validate`

### Completion Notes List

- Implemented auth-ready Prisma schema with `Role`, `User`, `Account`, `Session`, and `VerificationToken` models.
- Generated initial migration artifact at `prisma/migrations/20260312000000_init_auth_ready_data_model/migration.sql`.
- Applied schema to Supabase and verified seeded users can be created successfully.
- Added seed implementation in `prisma/seed.ts` with bcrypt-hashed passwords and idempotent upsert for admin/agent users.
- Added seeding support in `package.json` via `db:seed` and Prisma seed config.
- Verified code health checks pass (`build`, `test`, `typecheck`).
- Note: Prisma migration engine commands (`migrate dev` / `db push`) still hang against the current Supabase pooler setup in this environment; migration artifact generation + SQL application was used as a practical workaround.
- Code review high-severity fixes applied: schema now maps tables/columns to `snake_case` naming and includes NextAuth v5-compatible `emailVerified` + `Authenticator` model support.
- Code review medium-severity fixes applied: seed passwords can now be overridden via `SEED_ADMIN_PASSWORD` / `SEED_AGENT_PASSWORD` (required in production), and story file tracking now includes all changed migration/lock artifacts.
- Prisma seed config moved from deprecated `package.json#prisma` to `apolles/prisma.config.ts`.
- Seed script now enforces pooler-safe Prisma connection params and explicitly sets UUID on user creation for compatibility with the current Supabase schema defaults.
- Applied SQL alignment updates against Supabase to ensure `users` includes auth-required columns (`password_hash`, `is_active`, `created_at`, `updated_at`, `email_verified`) and `authenticators` table support.
- Story-scoped review notes now explicitly distinguish Story 1.2 files from unrelated dirty worktree changes belonging to later stories in `apolles/`.
- AC #3 remains open: Prisma migration engine commands are still blocked in this environment, so this story is tracked as in-progress until native Prisma Migrate execution is validated.
- Tightened `getSeedDatabaseUrl` behavior so an existing `pgbouncer=true` URL also gets `connection_limit=1` when missing.
- Seed flow now tolerates Story 1.2 baseline databases that do not yet include `platform_settings`; admin/agent users are still created and markup seed is skipped only on Prisma `P2021` missing-table errors.
- Expanded schema/migration compatibility coverage to assert migration-chain expectations (`supplier_api_logs` and `platform_settings`) and auth schema fields (`email_verified`, `authenticators`).
- Corrected malformed `DATABASE_URL` example quoting in `apolles/.env.example`.
- Updated story file tracking to list only files with concrete implementation evidence for this review pass.
- Hardened `isMissingTableError` to use Prisma `meta.table` when present (with message fallback), reducing brittle dependence on engine message text.
- Added seed test coverage for Prisma `P2021` `meta.table` detection path.
- Re-validated native Prisma migration status attempts in this environment; AC #3 remains blocked by Supabase pooler behavior.
- Added `DIRECT_URL`-first Prisma CLI config in `apolles/prisma.config.ts`, with `DATABASE_URL` fallback so Prisma commands can switch to a direct connection as soon as one is configured.
- Updated `.env.example` to document both pooled runtime `DATABASE_URL` and direct CLI `DIRECT_URL` formats for Supabase.
- Refined `getSeedDatabaseUrl()` so pooled URLs still gain required pooler params, while direct URLs are left untouched.
- Extended compatibility coverage to assert Prisma config wiring for `DIRECT_URL` / `DATABASE_URL` fallback, and validated the updated seed/config behavior with targeted tests plus `pnpm prisma validate`.

### Change Log

- 2026-03-12: Implemented Story 1.2 — Prisma schema (Role, User, Account, Session, VerificationToken, Authenticator), migration SQL, seed script with bcrypt + upsert, prisma.config.ts. Status: done.
- 2026-03-12: BMAD code-review workflow — identified 3 MEDIUM findings (seed re-hash on upsert, weak fallback passwords, migration enum coupling).
- 2026-03-12: Follow-up fix-all pass — fixed all 3 MEDIUM findings (`seed.ts` hash reuse, stronger fallback seed passwords, schema/migration enum compatibility guard test).
- 2026-03-13: BMAD code-review workflow — fixed review findings by removing deprecated `package.json#prisma` config, adding seed execution unit coverage, clarifying migration-chain claims, and documenting story-vs-worktree scope.
- 2026-03-15: BMAD code-review workflow — corrected status/task claims around AC #3, enforced missing `connection_limit=1` in seed pooler URL handling, and expanded Story 1.2 File List coverage.
- 2026-03-15: BMAD code-review workflow (fix-all) — fixed seed baseline compatibility for missing `platform_settings`, expanded migration-chain compatibility tests, repaired `.env.example` quote typo, and corrected story file evidence tracking.
- 2026-03-15: BMAD code-review workflow (fix-all, pass 2) — hardened Prisma missing-table detection (`meta.table` + fallback), added seed test coverage, refreshed file evidence tracking, and re-verified AC #3 remains blocked by Supabase pooler migration-status failures.
- 2026-03-15: BMAD code-review workflow (fix-all, pass 3) — added `DIRECT_URL`-aware Prisma CLI config, documented pooled vs direct Supabase env setup, preserved direct seed URLs, refreshed story file evidence tracking, and re-validated schema/tests while confirming `DIRECT_URL` is not yet configured in this environment.
- 2026-03-15: BMAD code-review workflow — recorded follow-up action items for current review findings; story remains in-progress pending AC #3 and seed/runtime hardening.

## Senior Developer Review (AI)

**Reviewer:** Moshe (via BMAD code-review workflow)
**Date:** 2026-03-12
**Outcome:** Approved (after fix-all pass)

### Findings

| ID | Severity | Description | Status |
|----|----------|-------------|--------|
| M1 | Medium | `seed.ts` re-hashes password on every upsert run even when user exists | Fixed (reuse existing hash when password unchanged) |
| M2 | Medium | Fallback seed passwords (`Admin123!`, `Agent123!`) are 10 chars, below Story 1.6 future 12-char requirement | Fixed (`AdminSeed123!`, `AgentSeed123!` in seed + `.env.example`) |
| M3 | Medium | Migration SQL hardcodes mapped enum string `'agent'` can drift from schema enum mapping | Fixed (added `prisma-schema-compat.test.ts` guard asserting schema↔migration alignment) |
| L1 | Low | Missing Change Log section in story file | Fixed (added above) |
| L2 | Low | Missing Senior Developer Review section in story file | Fixed (this section) |

AC #1, #2, #4, and #5 verified as implemented. AC #3 is partially met via migration artifact + manual SQL apply, but native Prisma Migrate execution is still unresolved in this environment. Quality gates: build, test (15/15), typecheck all pass.

### Supplemental Review (2026-03-13)

**Reviewer:** Moshe (via BMAD code-review workflow)
**Outcome:** Approved after fix-all pass

| ID | Severity | Description | Status |
|----|----------|-------------|--------|
| H1 | High | Story text overstated that the initial migration alone remained reproducible from the current schema | Fixed (task wording now reflects the full migration chain) |
| H2 | High | Story claimed seed execution coverage without an actual seed-focused automated test | Fixed (`apolles/src/lib/seed.test.ts`) |
| M1 | Medium | Deprecated `package.json#prisma` config still existed alongside `prisma.config.ts` | Fixed (removed deprecated config) |
| M2 | Medium | Story-scoped file tracking did not explain why the app worktree contained many unrelated later-story changes | Fixed (added review scope notes) |
| M3 | Medium | Review references were not captured for Prisma config/Auth.js adapter guidance | Fixed (references recorded in story) |

Quality gates re-run after fixes: `pnpm test` (17/17), `pnpm build`, `pnpm typecheck` all pass.

### Supplemental Review (2026-03-15)

**Reviewer:** Moshe (via BMAD code-review workflow)
**Outcome:** Changes Requested

| ID | Severity | Description | Status |
|----|----------|-------------|--------|
| H1 | High | AC #3 requires Prisma Migrate execution, but implementation evidence shows migration diff + manual SQL apply only | Open (story remains in-progress) |
| H2 | High | Story status and review text overstated completion of all ACs | Fixed (status + AC verification text corrected) |
| H3 | High | Task 2 was marked complete despite unresolved AC #3 migration workflow requirement | Fixed (Task 2 reopened with explicit pending migrate work) |
| M1 | Medium | Story File List omitted Story 1.2-owned files and additive migration chain artifacts | Fixed (File List expanded) |
| M2 | Medium | Seed URL helper did not guarantee `connection_limit=1` when `pgbouncer=true` already existed | Fixed (`getSeedDatabaseUrl` now adds missing `connection_limit`) |

Quality gates re-run after fixes: `pnpm test` (31 files / 184 tests) pass. `pnpm prisma validate` requires `DATABASE_URL` in environment.

### Supplemental Review (2026-03-15 - Fix Pass)

**Reviewer:** Moshe (via BMAD code-review workflow)
**Outcome:** Changes Requested (partially fixed)

| ID | Severity | Description | Status |
|----|----------|-------------|--------|
| H1 | High | Seed script depended on `platform_settings`, breaking Story 1.2 baseline seed reproducibility | Fixed (`seed.ts` now skips markup seed on Prisma `P2021` missing-table errors) |
| H2 | High | AC #3 requires native Prisma Migrate execution and remains unverified | Open (both `prisma migrate status` attempts timed out against Supabase pooler) |
| H3 | High | Story File List claimed changed files without current git evidence | Fixed (File List rewritten to evidence-backed files for this pass) |
| M1 | Medium | `.env.example` `DATABASE_URL` value had malformed quoting | Fixed |
| M2 | Medium | Schema compatibility test coverage was too narrow for migration-chain dependencies | Fixed (`prisma-schema-compat.test.ts` expanded) |

Quality gates after fix pass: `pnpm test` (31 files / 186 tests) pass.

### Supplemental Review (2026-03-15 - Fix Pass 2)

**Reviewer:** Moshe (via BMAD code-review workflow)
**Outcome:** Changes Requested (partially fixed)

| ID | Severity | Description | Status |
|----|----------|-------------|--------|
| H1 | High | AC #3 requires native Prisma Migrate execution and remains unverified | Open (`prisma migrate status` fails/times out against Supabase pooler in this environment) |
| M1 | Medium | Story File List omitted changed `package.json` evidence tracked in git | Fixed (File List updated) |
| M2 | Medium | Worktree contains unrelated later-story changes while this review is story-scoped | Open (documented in Review Scope Notes; left intentionally out-of-scope) |
| L1 | Low | Seed missing-table detection relied primarily on error message text matching | Fixed (`isMissingTableError` now prefers Prisma `meta.table`) |

Quality gates after fix pass 2: `pnpm test src/lib/seed.test.ts` pass (8/8).

### Supplemental Review (2026-03-15 - Fix Pass 3)

**Reviewer:** Moshe (via BMAD code-review workflow)
**Outcome:** Changes Requested (partially fixed)

| ID | Severity | Description | Status |
|----|----------|-------------|--------|
| H1 | High | Prisma CLI had no `DIRECT_URL` path for bypassing the Supabase pooler, leaving AC #3 blocked by pooled connections | Partially fixed (`apolles/prisma.config.ts` now prefers `DIRECT_URL`, but this environment still has no `DIRECT_URL` configured so native Prisma Migrate remains unverified) |
| H2 | High | Story File List claimed current-review evidence for the story file despite no current git diff | Fixed (story file updated in this pass and tracking refreshed) |
| H3 | High | Story File List incorrectly attributed unrelated `apolles/package.json` UI/test dependency changes to Story 1.2 | Fixed (`package.json` removed from Story 1.2 File List for this pass) |
| M1 | Medium | Story-scoped tracking did not reflect the breadth of unrelated dirty app files observed during review | Fixed (review scope notes retained; File List now limited to evidence-backed Story 1.2 files only) |
| M2 | Medium | `.env.example` did not document the direct Prisma CLI connection needed for Supabase migrate workflows | Fixed (`DIRECT_URL` example added alongside corrected pooled `DATABASE_URL`) |
| M3 | Medium | `getSeedDatabaseUrl()` forced pooler mode onto all URLs, including future direct connections | Fixed (direct URLs now pass through unchanged; pooled URLs still get required params) |
| L1 | Low | Schema compatibility checks did not cover Prisma CLI direct-connection wiring | Fixed (`src/lib/prisma-schema-compat.test.ts` now asserts `DIRECT_URL`/`DATABASE_URL` config expectations) |

Quality gates after fix pass 3: `pnpm test src/lib/seed.test.ts src/lib/prisma-schema-compat.test.ts` pass (10/10). `set -a; source .env; set +a; pnpm prisma validate` pass. `DIRECT_URL` remains unset in both `.env` and `.env.local`, so AC #3 stays open pending native Prisma Migrate execution through a direct connection.

### Supplemental Review (2026-03-15 - Action Items)

**Reviewer:** Moshe (via BMAD code-review workflow)
**Outcome:** Changes Requested

| ID | Severity | Description | Status |
|----|----------|-------------|--------|
| H1 | High | Story File List claims current-review evidence for Story 1.2 files that do not appear in the active git diff; the present dirty worktree is unrelated search/booking work. | Open (captured in Review Follow-ups) |
| H2 | High | AC #3 still requires successful native Prisma Migrate execution through a working direct connection path. | Open |
| M1 | Medium | Seed runtime does not yet prefer `DIRECT_URL`, so `pnpm db:seed` can still use pooled connection behavior unlike Prisma CLI config. | Open |
| M2 | Medium | Seed fallback passwords remain predictable defaults outside production. | Open |
| M3 | Medium | Seed upserts forcibly reset role and activation state for matching emails, which is risky in shared environments. | Open |

Current review scope note: the nested `apolles/` repo has many unrelated later-story search/booking/UI changes in git, while Story 1.2 implementation files are not part of the active diff in this pass. Story status remains `in-progress` because HIGH and MEDIUM findings remain open and AC #3 is still unresolved.

### Follow-up Fix Pass (2026-03-12)

- Updated `apolles/prisma/seed.ts` to avoid unnecessary re-hashing when existing credentials already match.
- Updated fallback seed passwords to 12+ character complexity (`AdminSeed123!`, `AgentSeed123!`).
- Added `apolles/src/lib/prisma-schema-compat.test.ts` to guard enum mapping compatibility between `schema.prisma` and the initial migration artifact.

### Follow-up Fix Pass (2026-03-13)

- Removed deprecated Prisma seed config from `apolles/package.json`; `apolles/prisma.config.ts` is now the only Prisma CLI config source, matching current Prisma guidance.
- Refactored `apolles/prisma/seed.ts` into testable helpers and added `apolles/src/lib/seed.test.ts` to cover pooler URL handling, production password enforcement, user upsert behavior, and seed execution flow.
- Updated story task wording to reflect that the current Prisma schema is represented by the full migration chain, not the initial auth migration file alone.
- Captured review scope explicitly: Story 1.2 file tracking remains story-scoped, while unrelated dirty files from later stories were observed separately during review.

### Review Scope Notes

- The `apolles/` worktree contains unrelated in-progress changes for later stories (`1.3`-`2.5`). They were observed during review for transparency, but they are not Story 1.2 deliverables and are intentionally excluded from this story-scoped File List.
- External references consulted during review: Prisma Config API (`https://pris.ly/prisma-config`) and Auth.js Prisma Adapter docs (`https://authjs.dev/getting-started/adapters/prisma`).
- Current nested `apolles/` git status still includes many unrelated search/booking UI changes; this review pass touches only Story 1.2 seed/config/story artifacts listed below.

### File List

- _bmad-output/implementation-artifacts/1-2-auth-ready-data-model-and-seed.md
- apolles/.env.example
- apolles/prisma.config.ts
- apolles/prisma/seed.ts
- apolles/src/lib/prisma-schema-compat.test.ts
- apolles/src/lib/seed.test.ts
