# Story 2.5: Search Service with Parallel Supplier Calls

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an **agent**,
I want to search for hotels and get results from both TBO and Expedia in one request,
so that I see inventory from both suppliers without searching separately.

## Acceptance Criteria

1. **Given** I submit a hotel search with destination, check-in, check-out, adults, children
   **When** the search Server Action is called
   **Then** it validates input with Zod, calls `requireAuth()`, then calls the search service.
2. **And** the search service calls both TBO and Expedia adapters using `Promise.allSettled()` (FR7).
3. **And** results from all responsive suppliers are combined into a flat array.
4. **And** the markup service applies the platform markup to every result's price before returning (FR32, FR33).
5. **And** if one adapter rejects (timeout/error), results from the responsive adapter are returned with a `supplierStatus` object indicating which supplier(s) failed (FR10).
6. **And** if both adapters reject, an empty results array is returned with both suppliers marked as failed (FR10a).
7. **And** the response shape is: `{ results: SupplierSearchResult[], supplierStatus: { tbo: 'success' | 'failed', expedia: 'success' | 'failed' } }`.
8. **And** combined search results return within 5 seconds for p95 queries (NFR1).
9. **And** search service has co-located tests covering: both succeed, one timeout, one error, both fail.

## Tasks / Subtasks

- [x] **Task 1: Define search service contracts and response shape** (AC: #3, #7)
  - [x] Create `apolles/src/features/search/search-service.ts` with a typed service entrypoint for supplier search aggregation.
  - [x] Define `supplierStatus` type using strict literals: `tbo: 'success' | 'failed'`, `expedia: 'success' | 'failed'`.
  - [x] Define a return type matching AC #7 exactly.

- [x] **Task 2: Implement parallel supplier calls with partial-failure behavior** (AC: #2, #3, #5, #6, #8)
  - [x] Call `tboAdapter.search(input)` and `expediaAdapter.search(input)` via `Promise.allSettled()`.
  - [x] Merge fulfilled results into one flat array without deduplication or mapping layer.
  - [x] Mark failed suppliers in `supplierStatus` while preserving successful supplier data.
  - [x] Return empty `results` with both suppliers marked failed when both promises reject.

- [x] **Task 3: Apply centralized markup service to all returned prices** (AC: #4)
  - [x] Read markup percentage using `getMarkupPercentage()` from `features/markup/markup-service.ts`.
  - [x] Apply `applyMarkup()` to every result's `lowestRate.supplierAmount` before response.
  - [x] Keep supplier adapters free of markup logic (service-layer responsibility only).

- [x] **Task 4: Implement search Server Action boundary** (AC: #1)
  - [x] Add server action (feature-local or route-local) that validates input with Zod.
  - [x] Enforce precondition sequence: `auth()` -> `requireAuth()` -> validate input -> service call.
  - [x] Return typed `ActionResult` shape consistent with existing `runProtectedAction` patterns.

- [x] **Task 5: Add co-located tests for service behavior and failure modes** (AC: #9)
  - [x] Create `apolles/src/features/search/search-service.test.ts`.
  - [x] Cover both suppliers success, one timeout, one non-timeout error, and both suppliers fail.
  - [x] Assert markup application is executed for every returned result amount.
  - [x] Assert `supplierStatus` object values are accurate for each failure matrix.

- [x] **Task 6: Verification and quality gates**
  - [x] Run `pnpm test --run src/features/search/search-service.test.ts`.
  - [x] Run `pnpm test --run`.
  - [x] Run `pnpm typecheck`.
  - [x] Run `pnpm build`.

## Dev Notes

- Story 2.5 is the orchestration layer for Epic 2 search; this is where adapter outputs become the single payload consumed by Story 2.6 UI.
- Keep implementation lean: no retries, no circuit breaker, no Redis, no SSE streaming, no deduplication, no cross-supplier merge model.
- Supplier-specific results remain independent objects (FR49-52): same real-world hotel can appear twice.

### Technical Requirements

- Use `Promise.allSettled()` exactly for dual-supplier fan-out so one supplier failure does not block the other.
- Maintain AC response shape exactly: `{ results, supplierStatus }`.
- Apply markup at service layer only using `getMarkupPercentage()` + `applyMarkup()`.
- Preserve normalized contract type safety from `features/suppliers/contracts/supplier-schemas.ts`.
- Keep explicit timeout semantics delegated to adapters (already enforced at 5 seconds in Stories 2.2/2.3).

### Architecture Compliance

- Respect layering: actions -> services -> adapters/Prisma.
- Put orchestration under `apolles/src/features/search/` (do not add a supplier orchestrator module).
- Reuse existing cross-cutting modules: `lib/authorize.ts`, `features/markup/markup-service.ts`, `lib/errors.ts`.
- Follow naming conventions already in repo: kebab-case files, camelCase functions, PascalCase types.

### Library / Framework Requirements

- Next.js App Router + TypeScript strict mode.
- Zod for input validation at Server Action boundary.
- Vitest 4 for unit tests with deterministic mocks.
- Promise concurrency behavior follows MDN `Promise.allSettled()` semantics: gather fulfilled + rejected outcomes without fail-fast rejection.

### File Structure Requirements

- **New files expected:**
  - `apolles/src/features/search/search-service.ts`
  - `apolles/src/features/search/search-service.test.ts`
- **Likely updates:**
  - `apolles/src/app/(app)/search/page.tsx` (wiring in upcoming stories)
  - `apolles/src/features/suppliers/contracts/supplier-adapter.ts` only if minimal non-breaking search input typing refinement is required
  - `apolles/src/lib/authorize.ts` only if action helper ergonomics require a small extension (avoid unnecessary edits)

### Testing Requirements

- Mock adapter calls to avoid external HTTP/API dependency in search-service tests.
- Validate partial-failure matrix precisely (`success/failed` per supplier).
- Include assertions proving markup is applied to each returned result, not just the first item.
- Add a test ensuring returned `results` remain flat and supplier-specific.
- Keep tests deterministic and fast; no real timers/network.

### Previous Story Intelligence

- Story 2.4 established `applyMarkup()` + `getMarkupPercentage()` as the canonical pricing primitive for this story.
- Story 2.4 review hardened error semantics (`VALIDATION_ERROR` for invalid/missing markup config), so this story should not reclassify markup config failures as supplier failures.
- Story 2.2/2.3 already enforce adapter-level 5-second timeouts and typed supplier errors; search service should aggregate outcomes, not duplicate adapter internals.
- Prior stories consistently use co-located unit tests and strict quality gates (`pnpm test --run`, `pnpm typecheck`, `pnpm build`).

### Git Intelligence Summary

- Root history is planning-focused; implementation conventions are in `apolles/`.
- `apolles` commit history is still foundation-first (`Complete Story 1.1 foundation updates`, `feat: initial commit`), so keep this story small, typed, and pattern-aligned.
- Existing feature structure already separates markup and supplier logic; search orchestration should be additive, not a refactor.

### Latest Tech Information

- MDN confirms `Promise.allSettled()` returns per-promise outcome objects (`status: fulfilled|rejected`) and does not short-circuit on rejection, which matches AC/NFR partial-failure needs.
- Current project uses Zod v3 today, while Zod v4 is now stable upstream; for this story, stay on existing project version and avoid migration churn.
- TypeScript strict mode remains required for this repo; retain explicit narrow types for supplier status literals and search response shape.

### Project Structure Notes

- No `project-context.md` exists in this repository.
- Runtime code belongs under `apolles/`; do not place implementation code in `_bmad/` or `_bmad-output/`.

### References

- Story 2.5 definition and ACs [Source: `_bmad-output/planning-artifacts/epics.md:544`]
- Epic 2 scope constraints and no-orchestrator decision [Source: `_bmad-output/planning-artifacts/epics.md:260`]
- Search flow with `Promise.allSettled()` and markup application [Source: `_bmad-output/planning-artifacts/architecture.md:970`]
- Cross-cutting locations (`authorize`, `markup-service`, supplier contracts) [Source: `_bmad-output/planning-artifacts/architecture.md:941`]
- FR7/FR10/FR10a and supplier-specific model constraints [Source: `_bmad-output/planning-artifacts/prd.md:474`]
- FR32/FR33 markup requirements [Source: `_bmad-output/planning-artifacts/prd.md:539`]

## Dev Agent Record

### Agent Model Used

openai/gpt-5.3-codex

### Debug Log References

- Create-story workflow context synthesis for Story 2.5
- Epic 2 extraction (`epics.md`) + architecture/PRD cross-check for orchestration and failure semantics
- Previous story intelligence extraction from Story 2.4 completion and code-review notes
- Git intelligence: `git log --oneline -5` (root + `apolles`)
- Web research: MDN `Promise.allSettled()` + Zod docs version notes
- `pnpm test --run src/features/search/search-service.test.ts`
- `pnpm test --run`
- `pnpm build`
- `pnpm typecheck` (required rerun after build regenerated `.next/types`)

### Completion Notes List

- Created implementation-ready Story 2.5 context focused on parallel supplier aggregation, partial-failure handling, and strict response contracts.
- Carried forward Story 2.4 pricing guardrails so markup remains centralized in `features/markup/markup-service.ts`.
- Added explicit test expectations for supplier failure matrix and per-result markup assertions to avoid silent regressions.
- Ultimate context engine analysis completed - comprehensive developer guide created.
- Implemented `features/search/search-service.ts` with `Promise.allSettled()` supplier fan-out, flat result aggregation, and typed `supplierStatus` output.
- Applied centralized platform markup (`getMarkupPercentage()` + `applyMarkup()`) to every returned result amount in search service.
- Added `app/(app)/search/actions.ts` server action boundary using `auth()` + `runProtectedAction()` + Zod validation for search inputs.
- Added `features/search/search-service.test.ts` coverage for both-success, one-timeout, one-error, and both-fail scenarios including markup assertions.
- Passed required quality gates (`pnpm test --run src/features/search/search-service.test.ts`, `pnpm test --run`, `pnpm build`, `pnpm typecheck`).
- Senior review fixes applied: added search-level 5-second timeout enforcement, enabled Expedia free-text destination lookup, aligned returned prices with marked-up values, and added server action / regression tests.

### File List

- _bmad-output/implementation-artifacts/2-5-search-service-with-parallel-supplier-calls.md
- apolles/src/app/(app)/search/actions.test.ts
- apolles/src/features/search/search-service.ts
- apolles/src/features/search/search-service.test.ts
- apolles/src/features/suppliers/adapters/expedia-adapter.ts
- apolles/src/features/suppliers/adapters/expedia-adapter.test.ts

## Senior Developer Review (AI)

### Reviewer

Moshe

### Date

2026-03-14

### Outcome

Approve

### Findings Resolved

- Fixed Expedia destination handling so free-text destinations can resolve through the regions lookup flow instead of requiring pre-mapped `region:` or `property:` input.
- Added a search-service timeout guard so supplier fan-out settles within the story's 5-second budget even if an adapter internally chains multiple requests.
- Aligned returned hotel pricing with the story contract by applying markup to the outgoing `lowestRate.supplierAmount` while also preserving `displayAmount` for UI consumers.
- Added regression coverage for flat supplier-specific aggregation and for the authenticated server action boundary (auth before validation, validation before service call).

### Residual Risks

- Expedia free-text lookup now supports the story contract, but production accuracy still depends on supplier region-search relevance and the eventual destination mapping UX in later stories.

## Change Log

- 2026-03-13: Created Story 2.5 and set status to ready-for-dev.
- 2026-03-13: Implemented search service parallel supplier orchestration, markup application, search action validation boundary, and co-located tests; ran quality gates and moved story to review.
- 2026-03-14: Completed senior review fixes for Expedia free-text destination lookup, 5-second search timeout enforcement, marked-up response pricing, and Story 2.5 regression coverage; approved story and moved status to done.
