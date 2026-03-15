# Story 2.6: Search Form UI

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an **agent**,
I want a clean search form on the home page,
so that I can quickly find hotels for my client.

## Acceptance Criteria

1. **Given** I am logged in and on the Search (home) page
   **When** the page loads
   **Then** I see a search form with fields: Destination (text input), Check-in date (date picker), Check-out date (date picker), Adults (number, default 2), Children (number, default 0, with age inputs when greater than 0).
2. **And** the form uses shadcn/ui components (`Input`, `Calendar` + `Popover` for dates, `Button`).
3. **And** the search button triggers search on click and Enter key in any field.
4. **And** all inputs are validated with Zod before submission: destination required, check-out after check-in, dates in the future, adults 1-6, children ages 0-17.
5. **And** the form validates on blur and shows errors at field level per UX spec.
6. **And** on submit the form scrolls to the first invalid field and focuses it.
7. **And** during search the button shows a spinner and the form remains visible.
8. **And** the search results area shows skeleton cards (6 cards) immediately on search submission.
9. **And** when results arrive, skeleton cards are replaced with real hotel cards or an error state.

## Tasks / Subtasks

- [x] **Task 1: Build the search page client flow and form state** (AC: 1, 3, 7)
  - [x] Replace the placeholder in `apolles/src/app/(app)/search/page.tsx` with the actual Search workspace shell while preserving the existing `PageHeader` pattern.
  - [x] Create a client-side search form component under `apolles/src/features/search/` that manages destination, dates, adults, children count, and dynamic children age inputs.
  - [x] Default the form to 1 room, 2 adults, 0 children to stay aligned with the current supplier contract and MVP scope.
  - [x] Trigger the existing `searchHotelsAction` on button click and Enter submission using the current client-side async pattern so the form stays visible while loading.

- [x] **Task 2: Add validation and accessibility behavior** (AC: 4, 5, 6)
  - [x] Add a feature-local Zod schema and form helpers for field-level blur validation matching the current `SupplierSearchInput` contract.
  - [x] Enforce destination required, check-out after check-in, both dates in the future, adults 1-6, and children ages 0-17.
  - [x] Reuse the existing admin form pattern for `aria-invalid`, `aria-describedby`, error ids, and first-invalid-field focus/scroll behavior.
  - [x] Keep keyboard submission native so Enter submits from any input.

- [x] **Task 3: Add date-picking primitives needed by the UX** (AC: 1, 2)
  - [x] Add the missing shadcn-style `Popover` and `Calendar` UI primitives under `apolles/src/components/ui/` because they do not exist in the current runtime app.
  - [x] Add any required dependency support for the calendar implementation in a way that stays consistent with the existing app stack.
  - [x] Use timezone-safe date handling so the selected date shown in the form matches the submitted ISO date.

- [x] **Task 4: Implement results loading, empty, and error states** (AC: 7, 8, 9)
  - [x] Add a results skeleton section that renders 6 placeholder cards immediately after valid submission.
  - [x] Render returned search results from Story 2.5 using a simple hotel-card presentation that can later evolve in Story 3.1 without requiring a rewrite.
  - [x] Show an explicit empty state when no results are returned and an inline error state when the action fails.
  - [x] Preserve the `supplierStatus` payload from `searchHotelsAction` so Story 3 supplier-status UI can build on it.

- [x] **Task 5: Add tests for form behavior and page integration** (AC: 3, 4, 5, 6, 8, 9)
  - [x] Add client/UI tests covering blur validation, dynamic child age fields, first-invalid-field focus, and loading-state behavior.
  - [x] Extend `apolles/src/app/(app)/search/actions.test.ts` only if the action contract changes; otherwise preserve the existing action tests.
  - [x] Add integration-style tests for valid submit to loading skeleton to rendered results, empty state, and error state.

- [x] **Task 6: Verification and quality gates**
  - [x] Run targeted tests for the new search form and page components.
  - [x] Run `pnpm test --run`.
  - [x] Run `pnpm typecheck`.
  - [x] Run `pnpm build`.

## Dev Notes

- Story 2.6 is the first agent-facing consumer of Epic 2 search. It turns the existing search action and aggregation service from Story 2.5 into the actual home-page workflow agents use.
- Keep scope lean and aligned with current runtime contracts: standard request/response search, no SSE, no supplier orchestrator, no Redis, no deduplication, no cross-supplier merge model, and no nationality/residency fields unless the contract is intentionally expanded in a separate change.
- The current codebase already has `searchHotelsAction` and `searchHotels`; this story should compose them into a polished UI rather than reworking search orchestration.

### Technical Requirements

- Use the existing authenticated search boundary in `apolles/src/app/(app)/search/actions.ts` and preserve the standard `ActionResult<T>` response shape.
- Keep the input contract aligned with `SupplierSearchInput`: `destination`, `checkIn`, `checkOut`, `rooms`, `adults`, `childrenAges`.
- Enforce MVP limits already established in the current action/schema: one room only, adults 1-6, child ages 0-17, destination required, and check-out after check-in.
- Add future-date validation at the UI schema layer because Story 2.6 explicitly requires dates in the future and the current server action does not yet enforce that rule.
- The form must remain visible during submission; loading feedback belongs in the submit button and results area, not in a full-page blocking state.
- Render skeleton cards immediately after a valid submit. Because the current search service waits for `Promise.allSettled()`, treat this as request-level loading rather than true per-supplier progressive append.

### Architecture Compliance

- Respect the established layer boundary: page/client component -> route-local Server Action -> `features/search/search-service.ts` -> supplier adapters.
- Keep runtime implementation under `apolles/`; do not place app code in `_bmad/` or `_bmad-output/`.
- Follow existing naming conventions: kebab-case files, camelCase functions, PascalCase component names and types.
- Reuse shared infrastructure already present in the app: `~/lib/authorize`, `~/components/ui/*`, `~/components/layout/page-header`, and `~/components/ui/skeleton`.
- Keep Story 2.6 additive. Do not refactor Story 2.5 search service or supplier adapters unless required for a narrowly scoped UI contract fix.

### Library / Framework Requirements

- Next.js App Router with React 19 client/server component split.
- Zod for client-side and server-side validation consistency.
- shadcn/ui-styled primitives already in-repo for `Button`, `Input`, `Card`, `Badge`, and `Skeleton`.
- Add shadcn-compatible `Calendar` and `Popover` primitives in-repo for date picking, with dependency support consistent with the app stack.
- Use the existing Sonner toast stack only if async feedback is needed beyond inline field and page states; do not rely on toast-only error communication for validation failures.

### File Structure Requirements

- **Primary files to update:**
  - `apolles/src/app/(app)/search/page.tsx`
  - `apolles/src/app/(app)/search/actions.ts` only if Story 2.6 requirements force a small contract refinement
  - `apolles/src/app/(app)/search/actions.test.ts` only if the action contract changes
- **Likely new feature files:**
  - `apolles/src/features/search/search-form.tsx`
  - `apolles/src/features/search/search-form-schema.ts`
  - `apolles/src/features/search/search-results-section.tsx`
  - `apolles/src/features/search/search-results-skeleton.tsx`
- **Likely new UI primitives:**
  - `apolles/src/components/ui/calendar.tsx`
  - `apolles/src/components/ui/popover.tsx`
- **Optional additive result components if helpful now:**
  - `apolles/src/features/search/hotel-result-card.tsx`
  - `apolles/src/features/search/search-empty-state.tsx`

### Testing Requirements

- Add co-located tests for new feature logic and keep tests deterministic with no external API calls.
- Cover blur validation, first-invalid-field focus/scroll, dynamic child age inputs, Enter-key submission, and loading-state rendering.
- Verify successful search renders returned results from Story 2.5 without flattening or mutating supplier identity semantics.
- Verify empty results and action failure states render clearly.
- Run the repo quality gates used by prior stories: targeted tests, `pnpm test --run`, `pnpm typecheck`, and `pnpm build`.

### Previous Story Intelligence

- Story 2.5 already completed the authenticated search action and service orchestration, so Story 2.6 should treat those as stable integration points rather than recreate search logic.
- Story 2.5 review added an overall search timeout guard and aligned returned pricing with marked-up values, so the UI should trust returned `lowestRate` pricing as the user-facing amount.
- Story 2.5 preserved `supplierStatus` in the response; Story 2.6 should keep that payload available in state because later UX stories need supplier availability banners and source-specific messaging.
- Previous Epic 2 stories consistently kept supplier concerns in adapters and pricing concerns in the centralized markup service. Do not move those responsibilities into the form layer.

### Git Intelligence Summary

- Root-level workflow commits are mostly BMAD artifact updates (`chore: update story 2.5 review artifacts and app pointer` pattern), so story artifact edits should stay minimal and structured.
- App-level commits show a review-fix pattern (`fix: close Story 2.5 review gaps`, `fix: harden markup pricing calculations`), which suggests implementation should be explicit, typed, and easy to review with narrow diffs.
- Current runtime search work is still foundation-first: Story 2.6 should add visible product value without broad architectural churn.

### Latest Tech Information

- Current Next.js guidance supports invoking Server Actions from Client Components through event handlers and `startTransition`, which matches the existing app pattern and is a good fit for a typed search form submission flow.
- shadcn/ui's current `Calendar` component is built on `react-day-picker`; it supports a `timeZone` prop, which helps avoid date-offset issues when converting selected dates into submitted values.
- React 19/Next App Router patterns continue to favor local pending states and action-driven updates for mutation-like workflows; Story 2.6 should use local loading state instead of introducing global state.
- Stay on the repo's existing dependency versions and avoid opportunistic migrations during this story.

### Project Structure Notes

- The planning docs suggest `features/search/actions/search-hotels.ts`, but the live repo currently uses route-local `apolles/src/app/(app)/search/actions.ts`. Follow the runtime structure unless a broader refactor is explicitly planned.
- The UX spec still describes supplier-by-supplier progressive append, while the implemented search service returns once the combined request settles. For this story, implement immediate skeletons and final result replacement, not streaming append behavior.
- No `project-context.md` file exists in this repository.

### Project Structure Notes

- Runtime code belongs under `apolles/`, which is consistent with the actual app layout already used by completed stories.
- Route-local search actions are an acceptable variance from the architecture doc's feature-local action example because they match the working repository pattern.
- Search field scope should remain aligned to the current shipped contract even though some planning artifacts mention nationality/residency; adding those now would expand the supplier contract beyond Story 2.6.

### References

- Story 2.6 definition and acceptance criteria [Source: `_bmad-output/planning-artifacts/epics.md:564`]
- Epic 2 scope and no-orchestrator constraints [Source: `_bmad-output/planning-artifacts/epics.md:257`]
- Search home-page and room-details route structure [Source: `_bmad-output/planning-artifacts/architecture.md:756`]
- Server Action pattern and validation order [Source: `_bmad-output/planning-artifacts/architecture.md:341`]
- Feature-based structure and co-located tests [Source: `_bmad-output/planning-artifacts/architecture.md:610`]
- Search data flow and markup application [Source: `_bmad-output/planning-artifacts/architecture.md:968`]
- FR6-FR10a hotel search requirements [Source: `_bmad-output/planning-artifacts/prd.md:473`]
- Search results performance and failure handling requirements [Source: `_bmad-output/planning-artifacts/prd.md:591`]
- Search UX, source indicators, and supplier unavailability patterns [Source: `_bmad-output/planning-artifacts/ux-design-specification.md:522`]
- Hotel card content and actions for near-term reuse [Source: `_bmad-output/planning-artifacts/ux-design-specification.md:594`]
- Existing search page placeholder [Source: `apolles/src/app/(app)/search/page.tsx:3`]
- Existing search action contract [Source: `apolles/src/app/(app)/search/actions.ts:10`]
- Existing supplier search input contract [Source: `apolles/src/features/suppliers/contracts/supplier-adapter.ts:9`]
- Existing search result schema [Source: `apolles/src/features/suppliers/contracts/supplier-schemas.ts:21`]
- Previous story context and review learnings [Source: `_bmad-output/implementation-artifacts/2-5-search-service-with-parallel-supplier-calls.md:108`]

## Dev Agent Record

### Agent Model Used

openai/gpt-5.4

### Debug Log References

- Create-story workflow execution using `_bmad/bmm/workflows/4-implementation/create-story/workflow.yaml`
- Full sprint status read from `_bmad-output/implementation-artifacts/sprint-status.yaml`
- Epic 2 / Story 2.6 extraction from `_bmad-output/planning-artifacts/epics.md`
- Architecture cross-check from `_bmad-output/planning-artifacts/architecture.md`
- PRD cross-check from `_bmad-output/planning-artifacts/prd.md`
- UX cross-check from `_bmad-output/planning-artifacts/ux-design-specification.md`
- Previous story intelligence from `_bmad-output/implementation-artifacts/2-5-search-service-with-parallel-supplier-calls.md`
- Repo exploration for current search runtime files and reusable UI patterns
- Git history review: `git log --oneline -5` at repo root and `apolles/`
- Web research: Next.js Server Actions guidance and shadcn/ui Calendar documentation
- Implemented Story 2.6 search workspace in `apolles/src/features/search/search-form.tsx` and integrated it via `apolles/src/app/(app)/search/page.tsx`
- Added search form schema and validation helpers in `apolles/src/features/search/search-form-schema.ts`
- Added results state model and rendering components in `apolles/src/features/search/search-form-state.ts`, `apolles/src/features/search/search-results-section.tsx`, `apolles/src/features/search/search-results-skeleton.tsx`, and `apolles/src/features/search/hotel-result-card.tsx`
- Added new shadcn-style primitives in `apolles/src/components/ui/popover.tsx` and `apolles/src/components/ui/calendar.tsx` plus calendar dependency support in `apolles/package.json`
- Validation run log: `pnpm test --run src/features/search/search-form-schema.test.ts src/features/search/search-form-state.test.ts`, `pnpm test --run`, `pnpm typecheck`, and `pnpm build`

### Implementation Plan

- Build a dedicated client-side search form feature that keeps form state and submission state local to the search route.
- Introduce a feature-local Zod schema and field helper functions to support blur validation, typed payload mapping, and first-invalid-field focus/scroll behavior.
- Add missing UI primitives (`Popover`, `Calendar`) and connect timezone-safe ISO conversion to avoid date-selection drift.
- Model results UI as explicit state transitions (idle/loading/success/empty/error) so skeletons, result cards, and inline errors render deterministically.
- Add focused tests for schema behavior and state transitions, then run full quality gates before marking the story for review.

### Completion Notes List

- Created implementation-ready Story 2.6 context for the first real search UI built on top of Story 2.5's completed action and service layer.
- Preserved lean MVP scope by keeping search request/response semantics simple and aligned with the current runtime contract.
- Added explicit guardrails around validation, date handling, skeleton loading, empty/error states, and future compatibility with supplier-status and hotel-card stories.
- Captured repo-specific structure mismatches so the dev agent can follow the live codebase rather than outdated planning examples.
- Ultimate context engine analysis completed - comprehensive developer guide created.
- Replaced the search page placeholder with an implemented search workspace shell while preserving the existing `PageHeader` pattern.
- Implemented a client-side search form with native Enter submission, loading button spinner, dynamic child age fields, and server action integration.
- Added feature-local Zod validation for destination, date ordering/future checks, adult range, and child age validation with blur-level feedback and a first-invalid-field focus/scroll path.
- Added shadcn-style `Popover` and `Calendar` UI primitives and integrated `react-day-picker` for date selection.
- Added results rendering flows for immediate skeletons, real cards, empty state, inline error state, and supplier failure badges while preserving `supplierStatus` in UI state.
- Added new tests for schema validation behavior and integration-style state transitions covering loading, success, empty, and error outcomes.
- Completed verification gates: targeted tests, full `pnpm test --run`, `pnpm typecheck`, and `pnpm build`.
- Fixed code review gaps by switching the date-picker popover to the Base UI primitive, preventing stale blur validation after calendar selection, and replacing agent-facing supplier names with neutral source labels.
- Added jsdom-backed `SearchForm` integration tests covering dynamic child age fields, blur validation, first-invalid focus/scroll, loading skeletons, success rendering, empty state, and error state.

### File List

- `_bmad-output/implementation-artifacts/2-6-search-form-ui.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `apolles/package.json`
- `apolles/pnpm-lock.yaml`
- `apolles/src/app/(app)/search/page.tsx`
- `apolles/src/components/ui/calendar.tsx`
- `apolles/src/components/ui/popover.tsx`
- `apolles/src/features/search/hotel-result-card.tsx`
- `apolles/src/features/search/search-form.test.tsx`
- `apolles/src/features/search/search-form-schema.test.ts`
- `apolles/src/features/search/search-form-schema.ts`
- `apolles/src/features/search/search-form-state.test.ts`
- `apolles/src/features/search/search-form-state.ts`
- `apolles/src/features/search/search-form.tsx`
- `apolles/src/features/search/search-results-section.tsx`
- `apolles/src/features/search/search-results-skeleton.tsx`
- `apolles/src/features/search/source-labels.ts`

### Story Completion Status

- Status set to `done`.
- Story implementation completed, review issues fixed, and quality gates passed; sprint status updated to `done`.
- Enhanced definition-of-done checklist manually validated against implemented code, tests, and story-tracking sections.

## Senior Developer Review (AI)

### Reviewer

Moshe

### Date

2026-03-14

### Outcome

Approve

### Findings

- Fixed task-verification gaps by adding `apolles/src/features/search/search-form.test.tsx` to exercise blur validation, dynamic child ages, invalid-field focus, loading skeletons, success rendering, empty states, and inline error states.
- Fixed stale date blur validation in `apolles/src/features/search/search-form.tsx` by validating against the next field values immediately after calendar selection and blur.
- Fixed agent-facing supplier leakage by introducing neutral source labels in `apolles/src/features/search/source-labels.ts` and applying them in `apolles/src/features/search/hotel-result-card.tsx` and `apolles/src/features/search/search-results-section.tsx`.
- Fixed popover accessibility/compliance concerns by replacing the custom popover with the Base UI popover primitive in `apolles/src/components/ui/popover.tsx`.

### Validation

- `pnpm test --run`
- `pnpm build`

## Change Log

- 2026-03-14: Started Story 2.6 implementation, marked sprint tracking status to in-progress, and replaced search-page placeholder with a production search workspace.
- 2026-03-14: Implemented client-side search form state, Zod validation, blur-level accessibility behavior, date picker primitives, and immediate skeleton/result/empty/error rendering.
- 2026-03-14: Added schema/state tests and completed quality gates (`pnpm test --run src/features/search/search-form-schema.test.ts src/features/search/search-form-state.test.ts`, `pnpm test --run`, `pnpm typecheck`, `pnpm build`), then moved story and sprint status to review.
- 2026-03-14: Completed code review fixes by swapping in the Base UI popover, hardening blur validation, hiding supplier identity behind neutral source labels, adding jsdom-backed search-form integration tests, and moving story plus sprint status to done.
