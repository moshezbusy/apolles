# Story 3.1: Hotel Result Cards with Source Indicators

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an **agent**,
I want to see hotel search results as cards with key information and source indicators,
so that I can quickly scan options and distinguish results from different sources.

## Acceptance Criteria

1. **Given** search results are loaded
   **When** the results grid renders
   **Then** each hotel is displayed as a `HotelResultCard` component showing: hotel name (semibold), star rating (icons), primary image (via `next/image` with lazy loading for below-fold), starting price (bold, medium weight, with markup applied), source indicator badge (`"Source A"` / `"Source B"`), meal plan badge, cancellation policy badge (`"Free cancel until [date]"` or `"Non-refundable"`), location (if available).
2. **And** source indicator badges use the `Micro` type scale (11px, medium weight) with a subtle neutral background.
3. **And** source labels are consistent within a search session: all TBO results share one label, all Expedia results share another.
4. **And** each card is an `<article>` with `aria-label="[Hotel Name], [Star Rating] stars, from $[Price]"`.
5. **And** action buttons are present: `View Rooms` (primary) -> room details page, `Book` (secondary) -> booking form for the cheapest rate.
6. **And** the results grid is 3-column on desktop (`xl+`), 2-column on tablet (`md-lg`), and 1-column on mobile (`< md`).
7. **And** prices use JetBrains Mono font.
8. **And** when there are no results, the empty state reads `No hotels found for these dates. Try different dates or destination.` with a `Search Again` action.
9. **And** a supplier-unavailability banner appears above results with amber styling, clear copy, and a retry action for the failed source.

## Tasks / Subtasks

- [x] **Task 1: Expand the hotel result card into the Epic 3 presentation model** (AC: 1, 2, 4, 7)
  - [x] Upgrade `apolles/src/features/search/hotel-result-card.tsx` from the Story 2.6 placeholder into the full `HotelResultCard` UI with hotel name, location, image area, star icons, source badge, meal-plan badge, cancellation badge, and marked-up price.
  - [x] Keep the card rooted in the existing `SupplierSearchResult` contract and treat returned pricing as already agent-facing; do not recompute markup in the UI.
  - [x] Use `next/image` for remote supplier imagery when a usable image URL exists, and provide a stable in-card fallback placeholder when no image is available or the URL is unusable.
  - [x] Update the card `aria-label` to announce hotel name, star rating, and formatted price instead of the current source-based label.

- [x] **Task 2: Formalize source-indicator presentation and card helpers** (AC: 2, 3)
  - [x] Keep `apolles/src/features/search/source-labels.ts` as the single source of truth for neutral supplier labels so TBO and Expedia remain stable as `Source A` and `Source B` within a session.
  - [x] Add any small feature-local helpers or a dedicated source-indicator component under `apolles/src/features/search/` if it improves reuse and keeps badge styling consistent.
  - [x] Style the source badge to match the UX spec's subtle micro-label treatment rather than the current generic outline badge.

- [x] **Task 3: Upgrade the results section and supplier-failure UX** (AC: 6, 8, 9)
  - [x] Replace the current destructive status chips in `apolles/src/features/search/search-results-section.tsx` with an amber supplier-unavailability banner placed above the results grid.
  - [x] Preserve the current lean search-state model (`idle | loading | success | empty | error`) and map failed suppliers into banner copy plus a retry action hook without introducing streaming or SSE behavior.
  - [x] Update the success grid and skeletons in `apolles/src/features/search/search-results-section.tsx` and `apolles/src/features/search/search-results-skeleton.tsx` so the card layout matches the 1/2/3-column responsive requirements.
  - [x] Update the empty-state copy and action treatment to the story language while preserving the existing search form as the retry surface.

- [x] **Task 4: Add route-safe card actions without pre-implementing future stories** (AC: 5)
  - [x] Introduce stable href construction for `View Rooms` and `Book` actions using the architecture's planned route shapes: `/search/[supplier]/[hotelId]` and `/booking/[supplier]/[hotelId]/[rateId]`.
  - [x] Because the live repo does not yet contain room-details or booking routes, add only the minimum navigation scaffolding required for Story 3.1 to satisfy the button-navigation acceptance criterion without implementing Story 3.3 or Epic 4 business flows early.
  - [x] Pass forward the supplier-specific identifiers and cheapest-rate context needed by later stories; do not invent a unified-hotel abstraction or merged supplier model.

- [x] **Task 5: Add focused UI and integration tests for the new result experience** (AC: 1, 3, 4, 5, 8, 9)
  - [x] Add co-located tests for `hotel-result-card` coverage: rendered metadata, source labels, price formatting, accessibility label, and image/fallback behavior.
  - [x] Add or extend search UI integration tests to cover supplier banner rendering, empty-state copy/action, and presence of `View Rooms` and `Book` actions.
  - [x] Keep tests aligned with the repo's current jsdom/manual React-root testing style unless there is already a stronger local pattern in the touched files.

- [x] **Task 6: Verification and quality gates**
  - [x] Run targeted tests for the updated search result components.
  - [x] Run `pnpm test --run`.
  - [x] Run `pnpm typecheck`.
  - [x] Run `pnpm build`.

## Dev Notes

- Story 3.1 is the first Epic 3 story and should build directly on the working Story 2.6 search page rather than introducing a new results architecture.
- Keep the MVP lean: no deduplication, no supplier-name exposure to agents, no streaming append behavior, no unified hotel model, and no orchestration layer.
- The current runtime app already has a functional search form and result-state pipeline; this story should elevate presentation quality and navigation readiness, not rework the supplier/search service contracts.

### Technical Requirements

- Use the existing result data shape in `apolles/src/features/suppliers/contracts/supplier-schemas.ts`, especially `supplier`, `supplierHotelId`, `hotelName`, `starRating`, `address`, `images`, `lowestRate`, and `supplierMetadata`.
- Treat `lowestRate.displayAmount ?? lowestRate.supplierAmount` as the agent-facing amount; Story 2.5 already applies markup in the search service and Story 2.6 assumes the UI displays that value as final search pricing.
- Preserve neutral source handling for agents. Supplier identity remains hidden in agent-facing UI even when Expedia/TBO-specific metadata exists internally.
- The supplier-failure UI should stay compatible with the current `supplierStatus: { tbo: 'success' | 'failed', expedia: 'success' | 'failed' }` response contract.
- If remote images are rendered with `next/image`, configure `images.remotePatterns` in `apolles/next.config.ts` narrowly enough to cover the supplier image hosts actually returned by the adapters.
- Use below-fold lazy loading defaults for hotel imagery and avoid introducing eager-loading behavior across the whole results grid.

### Architecture Compliance

- Respect the existing runtime layer boundary: search page/client component -> route-local Server Action -> `search-service.ts` -> supplier adapters.
- Keep all runtime code changes inside `apolles/`; do not place app code inside `_bmad/` or `_bmad-output/`.
- Follow established naming conventions: kebab-case files, camelCase functions, PascalCase component names/types, and co-located `.test.ts` / `.test.tsx` files.
- Do not add a deduplication layer, hotel mapping layer, supplier orchestrator, SSE path, or Redis-backed status flow.
- Do not expose raw supplier names in agent results, cards, or banners.

### Library / Framework Requirements

- Next.js App Router remains the runtime foundation; the current docs for `next/image` require explicit `remotePatterns` for remote URLs and recommend `sizes` when using responsive or `fill` image layouts.
- Use the repo's existing shadcn/ui primitives (`Card`, `Badge`, `Button`, `Skeleton`) and Tailwind token classes instead of introducing another component library.
- Use `lucide-react` icons directly for star-rating and status affordances; the package remains tree-shakable when icons are imported statically.
- Stay on the repo's current dependency set unless the story cannot be completed otherwise; avoid opportunistic upgrades.

### File Structure Requirements

- **Primary files to update:**
  - `apolles/src/features/search/hotel-result-card.tsx`
  - `apolles/src/features/search/search-results-section.tsx`
  - `apolles/src/features/search/search-results-skeleton.tsx`
  - `apolles/src/features/search/source-labels.ts`
  - `apolles/next.config.ts` if remote image allowlisting is required
- **Likely additive feature files:**
  - `apolles/src/features/search/source-indicator-badge.tsx`
  - `apolles/src/features/search/search-results-banner.tsx`
  - `apolles/src/features/search/result-card-helpers.ts`
- **Potential minimal route scaffolding if required for AC 5 only:**
  - `apolles/src/app/(app)/search/[supplier]/[hotelId]/page.tsx`
  - `apolles/src/app/(app)/booking/[supplier]/[hotelId]/[rateId]/page.tsx`

### Testing Requirements

- Add co-located tests for any new feature helpers/components and keep them deterministic with no live supplier calls.
- Verify the hotel card renders source labels, formatted prices, star-display output, badge content, and accessible article labels correctly.
- Verify supplier-failure banner behavior for one failed supplier while preserving visible results from the other supplier.
- Verify empty-state copy/action and responsive-grid/card rendering do not regress Story 2.6 search interactions.
- Run the repo quality gates already used in previous stories: targeted tests, `pnpm test --run`, `pnpm typecheck`, and `pnpm build`.

### Latest Tech Information

- Current Next.js Image guidance (Next.js docs version 16.1.6) requires remote image allowlisting via `images.remotePatterns`; `domains` is deprecated in favor of stricter patterns. Remote and responsive images should include explicit sizing behavior to avoid layout shift.
- Current `next/image` guidance also notes that lazy loading is the default and `fill` layouts require a positioned parent plus `sizes`; this fits hotel-card imagery if the card uses a fixed aspect-ratio wrapper.
- Current shadcn/ui badge guidance supports variant-based badges plus custom utility classes, which is a good fit for the subtle `Source A` / `Source B` micro-badge treatment required here.
- Current Lucide React guidance continues to favor direct static icon imports for tree-shaking; use explicit star/status icons instead of dynamic icon loading.

### Project Structure Notes

- The planning docs place domain components under `src/components/domain`, but the live repo already implements search UI under `apolles/src/features/search/`; continue with the live runtime structure.
- The architecture docs describe room-details and booking routes, but those pages do not yet exist in the current app. Story 3.1 should add only the minimal navigation scaffolding needed to keep card actions honest and implementation-ready.
- The current search service returns once both supplier promises settle, so Story 3.1 should not promise true progressive supplier-by-supplier append behavior in the UI.
- No `project-context.md` file exists anywhere in this repository.

### References

- Story 3.1 definition and acceptance criteria [Source: `_bmad-output/planning-artifacts/epics.md:590`]
- Epic 3 scope and no-dedup clarification [Source: `_bmad-output/planning-artifacts/epics.md:262`]
- Search-result FRs and supplier-specific display rules [Source: `_bmad-output/planning-artifacts/prd.md:473`]
- Supplier visibility, tax-display, and neutral-source requirements [Source: `_bmad-output/planning-artifacts/prd.md:332`]
- `next/image`, route structure, and search data-flow guidance [Source: `_bmad-output/planning-artifacts/architecture.md:734`]
- Search-result display, source indicators, and room-details route plan [Source: `_bmad-output/planning-artifacts/architecture.md:968`]
- Search results UX, source badges, and supplier banner treatment [Source: `_bmad-output/planning-artifacts/ux-design-specification.md:522`]
- Hotel-card content and action hierarchy [Source: `_bmad-output/planning-artifacts/ux-design-specification.md:594`]
- Current search route shell [Source: `apolles/src/app/(app)/search/page.tsx:1`]
- Current search form result pipeline [Source: `apolles/src/features/search/search-form.tsx:7`]
- Current results section implementation [Source: `apolles/src/features/search/search-results-section.tsx:1`]
- Current hotel card placeholder implementation [Source: `apolles/src/features/search/hotel-result-card.tsx:1`]
- Current neutral source mapping [Source: `apolles/src/features/search/source-labels.ts:1`]
- Current Next.js config lacks remote image configuration [Source: `apolles/next.config.ts:1`]

## Dev Agent Record

### Agent Model Used

openai/gpt-5.4

### Debug Log References

- Create-story workflow execution using `_bmad/bmm/workflows/4-implementation/create-story/workflow.yaml`
- Full sprint status read from `_bmad-output/implementation-artifacts/sprint-status.yaml`
- Epic 3 / Story 3.1 extraction from `_bmad-output/planning-artifacts/epics.md`
- Architecture cross-check from `_bmad-output/planning-artifacts/architecture.md`
- PRD cross-check from `_bmad-output/planning-artifacts/prd.md`
- UX cross-check from `_bmad-output/planning-artifacts/ux-design-specification.md`
- Repo exploration for current search runtime files and reusable result-card patterns under `apolles/src/features/search/`
- Web research: Next.js Image docs, shadcn/ui Badge docs, and Lucide React package guidance
- Implementation: upgraded the Story 2.6 placeholder card into the Story 3.1 result-card experience with helper-driven pricing, cancellation, image, and route-safe navigation logic
- Validation: `pnpm test --run src/features/search/hotel-result-card.test.tsx src/features/search/search-results-section.test.tsx src/features/search/result-card-helpers.test.ts`
- Validation: `pnpm test --run`
- Validation: `pnpm typecheck`
- Validation: `pnpm build`
- Review fix validation: `pnpm test --run src/features/search/search-form.test.tsx src/features/search/search-results-section.test.tsx src/features/search/hotel-result-card.test.tsx src/features/search/result-card-helpers.test.ts src/features/search/search-form-state.test.ts src/features/search/search-form-schema.test.ts src/features/search/search-service.test.ts src/features/suppliers/contracts/supplier-schemas.test.ts src/features/suppliers/adapters/expedia-adapter.test.ts src/features/suppliers/adapters/tbo-adapter.test.ts`
- Review fix validation: `pnpm test --run`
- Review fix validation: `pnpm typecheck`

### Implementation Plan

- Expand the existing Story 2.6 placeholder hotel card into the full agent-facing result-card UI without changing the search-service contract.
- Keep source-label handling centralized and style it as the subtle micro-badge required by the UX spec.
- Replace the current failure chips with an amber supplier-status banner while keeping the lean `supplierStatus` response model intact.
- Add route-safe result-card actions that pass supplier-specific identifiers forward without prematurely implementing Epic 3 room-details logic or Epic 4 booking logic.
- Add focused UI tests and then run the full repo quality gates before moving the story to development.
- Extend the lowest-rate search result contract with `rateId` so the cheapest-rate booking action can navigate honestly without inventing a unified hotel abstraction.
- Keep retry behavior anchored to the existing search form by retrying only the failed supplier when possible and returning empty-state recovery to the existing form controls.

### Completion Notes List

- Created implementation-ready Story 3.1 context for upgrading the existing search results from Story 2.6 into the first full Epic 3 browsing experience.
- Captured the live repo structure under `apolles/src/features/search/` so implementation follows the current runtime instead of older planning-only component locations.
- Highlighted the route-gap risk: room-details and booking pages are planned in architecture but not yet present in the live app, so Story 3.1 must add only minimal navigation scaffolding.
- Added explicit guardrails for `next/image` remote host allowlisting, neutral source handling, and no-markup-recalculation in the UI.
- Ultimate context engine analysis completed - comprehensive developer guide created.
- Upgraded `HotelResultCard` to render remote imagery with fallback, star icons, micro source badge treatment, cancellation and meal badges, JetBrains Mono pricing, and accessible article labels.
- Added helper-driven `View Rooms` and `Book` href construction plus minimal `/search/[supplier]/[hotelId]` and `/booking/[supplier]/[hotelId]/[rateId]` route scaffolds that carry search context forward.
- Replaced destructive supplier chips with an amber supplier-unavailability banner, preserved the lean search-state model, and wired retry/search-again actions through the existing form workflow.
- Extended the search result contract with lowest-rate `rateId` support across supplier adapters so booking navigation targets the cheapest known rate safely.
- Added deterministic helper, card, section, and search-form tests and passed `pnpm test --run`, `pnpm typecheck`, and `pnpm build`.
- Fixed code-review findings by making supplier retries source-specific, turning total supplier outages into a retry-all error state, and keeping empty-state recovery focused on the search form instead of replaying the query.
- Removed agent-facing supplier-name leakage from the temporary route scaffolds, tightened result-card accessibility labels, restored optional-location handling in normalized supplier results, and rejected impossible calendar dates.
- Simplified remote image handling to accept valid HTTPS supplier imagery, corrected Expedia address duplication, and re-ran targeted tests, the full test suite, and `pnpm typecheck` successfully.

### File List

- `_bmad-output/implementation-artifacts/3-1-hotel-result-cards-with-source-indicators.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `apolles/next.config.ts`
- `apolles/src/app/(app)/booking/[supplier]/[hotelId]/[rateId]/page.tsx`
- `apolles/src/app/(app)/search/actions.test.ts`
- `apolles/src/app/(app)/search/actions.ts`
- `apolles/src/app/(app)/search/[supplier]/[hotelId]/page.tsx`
- `apolles/src/features/search/hotel-result-card.test.tsx`
- `apolles/src/features/search/hotel-result-card.tsx`
- `apolles/src/features/search/result-card-helpers.test.ts`
- `apolles/src/features/search/result-card-helpers.ts`
- `apolles/src/features/search/search-form-schema.test.ts`
- `apolles/src/features/search/search-form-schema.ts`
- `apolles/src/features/search/search-form.test.tsx`
- `apolles/src/features/search/search-form.tsx`
- `apolles/src/features/search/search-form-state.test.ts`
- `apolles/src/features/search/search-form-state.ts`
- `apolles/src/features/search/search-results-banner.tsx`
- `apolles/src/features/search/search-results-section.test.tsx`
- `apolles/src/features/search/search-results-section.tsx`
- `apolles/src/features/search/search-results-skeleton.tsx`
- `apolles/src/features/search/source-indicator-badge.tsx`
- `apolles/src/features/search/search-service.test.ts`
- `apolles/src/features/suppliers/adapters/expedia-adapter.test.ts`
- `apolles/src/features/suppliers/adapters/expedia-adapter.ts`
- `apolles/src/features/suppliers/adapters/tbo-adapter.test.ts`
- `apolles/src/features/suppliers/adapters/tbo-adapter.ts`
- `apolles/src/features/suppliers/contracts/supplier-schemas.test.ts`
- `apolles/src/features/suppliers/contracts/supplier-schemas.ts`

### Story Completion Status

- Status set to `done` after review fixes and revalidation.
- Story implementation, review remediation, and sprint tracking synchronization completed.

### Senior Developer Review (AI)

- Reviewer: Moshe
- Date: 2026-03-15
- Outcome: Approved after fixes
- Review notes: Fixed the failed-source retry path so it retries only the targeted supplier, mapped both-supplier outages to an explicit retry-all error state, and changed the empty-state action to return focus to the search form.
- Review notes: Removed raw supplier-name leakage from the temporary room-details and booking routes, tightened source badge and action accessibility labels, and restored optional-location handling in normalized supplier results.
- Review notes: Hardened date parsing, corrected Expedia address normalization, widened HTTPS remote-image handling for supplier imagery, and re-ran targeted tests, the full test suite, and `pnpm typecheck` successfully.

## Change Log

- 2026-03-15: Created Story 3.1 with comprehensive implementation context, repo-specific guardrails, and development-ready tasks.
- 2026-03-15: Implemented Story 3.1 hotel-result cards, supplier failure banner UX, route-safe result actions, lowest-rate `rateId` propagation, and Story 3.1 test/build validation.
- 2026-03-15: Fixed code-review findings for supplier retry behavior, outage handling, accessibility, neutral-source route scaffolding, optional location parsing, and image/date robustness; validated with targeted tests, full tests, and typecheck.
