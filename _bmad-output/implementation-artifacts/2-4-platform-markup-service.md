# Story 2.4: Platform Markup Service

Status: in-progress

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the **platform**,
I want a centralized markup calculation module,
so that all supplier rates have the platform markup applied consistently before display.

## Acceptance Criteria

1. **Given** the markup service exists in `src/features/markup/markup-service.ts`
   **When** `applyMarkup(supplierAmount, markupPercentage)` is called
   **Then** the result is `supplierAmount * (1 + markupPercentage / 100)` rounded to 2 decimal places (half-up) (FR32).
2. **And** the markup percentage is read from the `platform_settings` table (key: `markup_percentage`).
3. **And** the `platform_settings` Prisma model is created: `key` (unique string), `value` (string), `updatedAt`, `updatedBy` (FK to users).
4. **And** a seed migration sets the initial markup percentage (e.g., 12%).
5. **And** the markup service is a pure function used by: search results, price recheck, booking confirmation — one source of truth (FR33).
6. **And** co-located unit tests cover: zero markup, typical markup (12%), edge cases (0.1%, 100%), rounding precision verified to the cent.

## Tasks / Subtasks

- [x] **Task 1: Implement pure markup calculation service** (AC: #1, #5)
  - [x] Create `apolles/src/features/markup/markup-service.ts` with `applyMarkup(supplierAmount, markupPercentage)` pure function.
  - [x] Enforce deterministic cent rounding (2 decimals, half-up) for non-negative monetary values.
  - [x] Export reusable helper(s) from this module only; avoid inline markup math in other features.

- [x] **Task 2: Add platform settings persistence model** (AC: #2, #3)
  - [x] Add `PlatformSetting` Prisma model to `apolles/prisma/schema.prisma` with `key`, `value`, `updatedAt`, `updatedBy` relation to `User`.
  - [x] Generate migration for schema changes.
  - [x] Add minimal typed accessor in markup feature to read current `markup_percentage` from DB.

- [x] **Task 3: Seed default markup configuration** (AC: #4)
  - [x] Update seed flow to insert `platform_settings.key = "markup_percentage"` with initial value (default `12`).
  - [x] Ensure seed path is idempotent (upsert/update, no duplicate key failures).
  - [x] Validate seed runs with existing Story 1.x seed data.

- [x] **Task 4: Prepare one-source-of-truth integration boundary** (AC: #5)
  - [x] Ensure upcoming consumers (`search-service`, booking recheck/confirmation paths) can call the markup module directly.
  - [x] Keep adapters free of markup logic; adapters should continue returning supplier-side base amounts.
  - [x] Do not implement orchestration/search aggregation logic here (belongs to Story 2.5).

- [x] **Task 5: Add co-located unit tests for markup behavior** (AC: #6)
  - [x] Create `apolles/src/features/markup/markup-service.test.ts`.
  - [x] Cover: 0%, 12%, 0.1%, 100%, and cent-rounding edge inputs.
  - [x] Add tests for invalid inputs handling strategy chosen in implementation (e.g., reject negative amount/percentage).

- [x] **Task 6: Verification and quality gates**
  - [x] Run `pnpm test --run src/features/markup/markup-service.test.ts`.
  - [x] Run `pnpm test --run`.
  - [x] Run `pnpm typecheck`.
  - [x] Run `pnpm build`.

## Dev Notes

- Story 2.4 is the pricing foundation for Story 2.5 search aggregation and later booking flows. Treat this service as the canonical pricing primitive.
- Keep scope lean: one global markup percentage (no per-agent override, no layered markup chain).
- Markup must be applied server-side only (never trusted from client input).
- Do not add Redis/circuit-breaker/retries/orchestrator logic in this story.

### Technical Requirements

- Markup formula must match FR32 exactly: `supplierAmount * (1 + markupPercentage / 100)`.
- Use a pure function in `features/markup/markup-service.ts` as the single source of truth for markup math.
- Persist/read markup config through `platform_settings` (`key = markup_percentage`) and keep data access typed.
- Keep supplier adapters returning supplier base prices; markup belongs in service layer (search/booking flows).
- Use existing typed error patterns (`AppError`, `ErrorCodes`) for recoverable failures.

### Architecture Compliance

- Place pricing logic under `apolles/src/features/markup/`; do not scatter price math across actions/components.
- Preserve feature boundaries: actions -> services -> adapters/Prisma.
- Keep tests co-located with feature code.
- Respect naming conventions already used in project (kebab-case files, camelCase functions, PascalCase types).

### Library / Framework Requirements

- Next.js App Router + TypeScript strict mode.
- Prisma 6 for schema/model/migration.
- Vitest 4 for unit tests.
- Zod only where boundary validation is needed (not required for a simple pure arithmetic helper).

### File Structure Requirements

- **New files expected:**
  - `apolles/src/features/markup/markup-service.ts`
  - `apolles/src/features/markup/markup-service.test.ts`
  - `apolles/prisma/migrations/*` (generated migration for `platform_settings`)
- **Likely updates:**
  - `apolles/prisma/schema.prisma`
  - `apolles/prisma/seed.ts` (or active seed entrypoint in repo)
  - `apolles/src/lib/db.ts` only if required by implementation structure (avoid unnecessary edits)

### Testing Requirements

- Use deterministic unit tests for rounding to cent precision.
- Include boundary percentages from ACs (`0`, `12`, `0.1`, `100`).
- Cover floating-point-sensitive values (e.g., values ending in `.005`) to prevent regressions.
- Keep tests isolated from external APIs and network.

### Previous Story Intelligence

- Story 2.3 finalized adapter hardening and test rigor: include edge-case tests up-front and do not defer quality gaps to review.
- Story 2.3 confirmed adapter responsibility boundaries: supplier adapters normalize supplier data; cross-cutting behavior belongs in dedicated services.
- Story 2.2/2.3 reinforced mandatory gates (`pnpm test`, `pnpm typecheck`, `pnpm build`) before marking done.
- Existing supplier modules rely on typed error translation and non-leaky failure messages; keep this standard in markup data-access paths.

### Git Intelligence Summary

- Root commits are planning-heavy; implementation conventions are established in the `apolles` app repo.
- `apolles` commit history is short and foundation-first (`Complete Story 1.1 foundation updates`, `feat: initial commit`), so keep changes minimal and aligned with existing patterns.
- Current structure already expects `features/markup/markup-service.ts`; implementing exactly there minimizes architectural drift.

### Latest Tech Information

- MDN documents `Math.round()` half-step behavior toward `+Infinity`; for positive price values this matches half-up cent rounding expectations when applied on scaled cents.
- Prisma documents `Decimal` support via `Prisma.Decimal` (Decimal.js). If floating-point edge behavior becomes problematic, keep a clear migration path to Decimal-based arithmetic without changing business formula.
- Current project stack remains Next.js 15 + Prisma 6 + Vitest 4; stay compatible with strict TypeScript settings used across supplier stories.

### Project Structure Notes

- No `project-context.md` exists in this repository.
- Runtime code belongs under `apolles/`; do not place implementation code inside `_bmad/` or `_bmad-output/`.

### References

- Story 2.4 definition and ACs [Source: `_bmad-output/planning-artifacts/epics.md:527`]
- Epic 2 scope and boundaries [Source: `_bmad-output/planning-artifacts/epics.md:257`]
- Markup cross-cutting decision (`applyMarkup`) [Source: `_bmad-output/planning-artifacts/architecture.md:148`]
- `platform_settings` schema expectations [Source: `_bmad-output/planning-artifacts/architecture.md:248`]
- Search/book flow must apply markup service [Source: `_bmad-output/planning-artifacts/architecture.md:973`]
- FR31/FR32/FR33 product requirements [Source: `_bmad-output/planning-artifacts/prd.md:539`]

## Dev Agent Record

### Agent Model Used

openai/gpt-5.3-codex

### Debug Log References

- Create-story workflow context synthesis for Story 2.4
- Epic 2 extraction (`epics.md`) + architecture/PRD cross-check for markup constraints
- Previous story intelligence extraction from Story 2.3 completion notes and review outcomes
- Git intelligence: `git log --oneline -5` (root + `apolles`)
- Web research: MDN `Math.round()` and Prisma Decimal docs
- `pnpm test --run src/features/markup/markup-service.test.ts` (red phase fail before implementation)
- `pnpm prisma generate`
- `pnpm test --run src/features/markup/markup-service.test.ts` (green)
- `pnpm test --run`
- `pnpm build`
- `pnpm typecheck`
- `pnpm test --run src/features/markup/markup-service.test.ts` (post-review fixes)
- `pnpm test --run` (post-review fixes)
- `pnpm build` (post-review fixes)
- `pnpm typecheck` (post-review fixes)

### Completion Notes List

- Created implementation-ready Story 2.4 context focused on pricing correctness, one-source-of-truth service boundaries, and migration/seed requirements.
- Explicitly constrained scope to Lean MVP (single platform markup, no per-agent override, no orchestration logic).
- Added carry-over quality guardrails from Stories 2.2/2.3 (typed errors, edge-case testing, mandatory quality gates).
- Included DB + seed expectations for `platform_settings` with idempotency guidance.
- Ultimate context engine analysis completed - comprehensive developer guide created.
- Implemented `features/markup/markup-service.ts` with pure `applyMarkup()` formula and deterministic cent rounding.
- Added typed markup configuration accessor `getMarkupPercentage()` that reads `platform_settings.markup_percentage` from Prisma and validates values.
- Added `PlatformSetting` Prisma model and relation to `User`, plus migration `20260313014500_add_platform_settings`.
- Updated seed flow to upsert the default platform setting (`markup_percentage = "12"`) with admin user attribution.
- Added comprehensive `markup-service.test.ts` coverage for AC-required percentages, rounding edge cases, and invalid input handling.
- Completed all required quality gates successfully (`test`, `typecheck`, `build`).
- Code-review fixes: corrected missing markup-setting error classification to `VALIDATION_ERROR` to avoid supplier-error misclassification.
- Code-review fixes: added missing zero-supplier-amount edge-case unit test and updated missing-setting test expectation to `VALIDATION_ERROR`.
- Code-review fixes: documented `roundToCents` numeric-range limitation for future maintainability.
- 2026-03-14 review fixes: corrected half-up rounding for `10.075`-style values, added markup upper-bound validation, and preserved raw supplier prices by adding a separate marked-up display amount.
- 2026-03-14 review fixes: added a follow-up Prisma migration to seed `platform_settings.markup_percentage` when an admin user already exists.
- 2026-03-14 review result: Story 2.4 still cannot satisfy the booking/price-recheck usage portion of AC #5 because Epic 4 booking flows have not been implemented in the codebase yet.

### Senior Developer Review (AI)

- Reviewer: Moshe
- Date: 2026-03-14
- Outcome: Changes Requested -> Fixed Automatically -> Follow-up Required
- Findings addressed: 2 High, 2 Medium (4 total fixed)
- Notes:
  - Fixed incorrect cent rounding in `apolles/src/features/markup/markup-service.ts` and added regression coverage for `10.075 -> 10.08`.
  - Added validation that rejects markup values above 100% and covered the guard in unit tests.
  - Preserved raw supplier pricing by keeping `lowestRate.supplierAmount` untouched and adding `lowestRate.displayAmount` in search results.
  - Added `apolles/prisma/migrations/20260314120500_seed_platform_markup_default/migration.sql` to backfill the default markup setting when an admin user already exists.
  - Story remains in-progress because AC #5 still claims usage in price recheck and booking confirmation flows, but `apolles/src/features/booking/` does not exist yet in this repository.

### File List

- _bmad-output/implementation-artifacts/2-4-platform-markup-service.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- apolles/prisma/schema.prisma
- apolles/prisma/seed.ts
- apolles/prisma/migrations/20260313014500_add_platform_settings/migration.sql
- apolles/prisma/migrations/20260314120500_seed_platform_markup_default/migration.sql
- apolles/src/features/markup/markup-service.ts
- apolles/src/features/markup/markup-service.test.ts
- apolles/src/features/search/search-service.ts
- apolles/src/features/search/search-service.test.ts
- apolles/src/features/suppliers/contracts/supplier-schemas.ts

## Change Log

- 2026-03-13: Created Story 2.4 and set status to ready-for-dev.
- 2026-03-13: Implemented markup service, added PlatformSetting schema + migration + seed default, added unit tests, ran quality gates, and moved story to review.
- 2026-03-13: Completed adversarial code review fixes (error-code classification, missing zero-amount test, rounding helper note), reran quality gates, synced sprint status, and moved story to done.
- 2026-03-14: Fixed markup rounding and validation gaps, preserved raw supplier prices with a separate display amount, added a markup backfill migration, reran targeted tests, and moved story back to in-progress because booking/recheck consumers do not exist yet.
