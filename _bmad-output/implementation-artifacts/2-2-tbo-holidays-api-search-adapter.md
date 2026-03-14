# Story 2.2: TBO Holidays API Search Adapter

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **developer**,
I want a TBO adapter implementing the supplier interface for hotel search,
so that TBO hotel inventory is available through the normalized contract.

## Acceptance Criteria

1. **Given** the `SupplierAdapter` interface exists from Story 2.1
   **When** the TBO adapter implements `search()`
   **Then** it authenticates using Basic Auth per TBO API v1.4 requirements.
2. **And** search parameters (destination, dates, rooms, adults, children with ages) are mapped to TBO HotelSearch request format.
3. **And** TBO responses are normalized into the Apolles supplier contract model from Story 2.1.
4. **And** the adapter enforces a 5-second timeout and returns typed `SUPPLIER_TIMEOUT` on expiry.
5. **And** every TBO API call is logged to `supplier_api_logs` via the shared supplier logging helper.
6. **And** TBO-specific failures are translated to Apolles typed errors (`SUPPLIER_ERROR`, `RATE_UNAVAILABLE`, or `SUPPLIER_TIMEOUT`) and raw TBO errors do not leak to higher layers.
7. **And** co-located unit tests in `tbo-adapter.test.ts` cover successful search, timeout, auth failure, malformed response, and empty results.

## Tasks / Subtasks

- [x] **Task 1: Implement TBO adapter module and auth** (AC: #1)
  - [x] Create `src/features/suppliers/adapters/tbo-adapter.ts` exporting a `tboAdapter` that satisfies `SupplierAdapter`.
  - [x] Implement request auth using Basic Auth credentials from env (`TBO_API_KEY`, `TBO_API_SECRET`) and fail fast with typed errors if missing.
  - [x] Keep adapter-scoped supplier constant as `"tbo"` and avoid leaking supplier identity to agent-facing UI concerns.

- [x] **Task 2: Implement search request mapping** (AC: #2)
  - [x] Map normalized search input (`destination`, `checkIn`, `checkOut`, `rooms`, `adults`, `childrenAges`) to TBO HotelSearch payload shape.
  - [x] Preserve strict date/capacity mapping semantics (no hidden defaults, no inferred room splitting).
  - [x] Keep mapping isolated in adapter-local pure functions for testability.

- [x] **Task 3: Normalize TBO response to Story 2.1 contracts** (AC: #3)
  - [x] Normalize response records into `SupplierSearchResult` with required fields: `supplier`, `supplierHotelId`, `hotelName`, `starRating`, `lowestRate`.
  - [x] Validate normalized payloads with Story 2.1 schemas before returning.
  - [x] Handle missing/invalid upstream fields defensively and translate failures to typed errors.

- [x] **Task 4: Add timeout + logging wrapper integration** (AC: #4, #5)
  - [x] Enforce a hard 5-second timeout for the supplier HTTP call.
  - [x] Wrap call execution with `withSupplierApiLogging(...)` to persist method, endpoint, duration, status, request/response metadata.
  - [x] Ensure logger failures never break successful adapter responses (Story 2.1 review fix).

- [x] **Task 5: Translate supplier errors to platform errors** (AC: #6)
  - [x] Map timeout -> `SUPPLIER_TIMEOUT`.
  - [x] Map unavailable rate/search-zero semantics only where appropriate -> `RATE_UNAVAILABLE` (do not overuse for generic transport failures).
  - [x] Map all remaining upstream/API failures -> `SUPPLIER_ERROR` with safe messages.

- [x] **Task 6: Add adapter tests** (AC: #7)
  - [x] Create co-located `src/features/suppliers/adapters/tbo-adapter.test.ts`.
  - [x] Add deterministic tests for: success mapping, timeout handling, auth failure, malformed response, empty results.
  - [x] Assert logging wrapper is called with expected method/endpoint and that typed errors are returned.

- [x] **Task 7: Verification and quality gates**
  - [x] Run `pnpm test`.
  - [x] Run `pnpm typecheck`.
  - [x] Run `pnpm build`.

## Dev Notes

- This story delivers the first concrete adapter implementation behind the shared supplier contract created in Story 2.1.
- Scope is search adapter only. `getRoomDetails()`, `recheckPrice()`, and `book()` implementation behavior can remain minimal/non-production for this story if not required by tests, but must keep interface compatibility.
- Keep implementation adapter-local; orchestration across suppliers remains in Story 2.5 (`Promise.allSettled`).
- Do not introduce Redis, retries, circuit breaker, deduplication, or mapping layers.

### Technical Requirements

- Adapter must implement the existing `SupplierAdapter` contract in `src/features/suppliers/contracts/supplier-adapter.ts`.
- Normalization target is Story 2.1 schema/types in `src/features/suppliers/contracts/supplier-schemas.ts`.
- Timeout rule is global and strict: 5 seconds per supplier call, no retry.
- Use existing typed app errors from `src/lib/errors.ts` (`SUPPLIER_TIMEOUT`, `SUPPLIER_ERROR`, `RATE_UNAVAILABLE`).
- All supplier calls must go through shared logging helper `src/features/suppliers/supplier-logger.ts`.

### Architecture Compliance

- Respect layer boundaries: adapter is infra boundary under `features/suppliers/adapters/`; no UI concerns, no direct page/action logic.
- Keep output supplier-specific (`supplier = "tbo"`, `supplierHotelId`) and do not attempt cross-supplier merge or dedup.
- Follow naming conventions: kebab-case files, PascalCase exported types, camelCase identifiers.
- Keep tests co-located with adapter source.

### Library / Framework Requirements

- Next.js App Router + TypeScript strict mode.
- Zod validation from existing supplier schema contracts.
- Prisma-backed supplier logging via shared logger helper.
- Vitest for adapter unit tests.

### File Structure Requirements

- **New files expected:**
  - `apolles/src/features/suppliers/adapters/tbo-adapter.ts`
  - `apolles/src/features/suppliers/adapters/tbo-adapter.test.ts`
- **Potential updates:**
  - `apolles/src/features/suppliers/contracts/supplier-adapter.ts` (only if minimal compatibility refinement is needed)
  - `apolles/src/features/suppliers/contracts/supplier-schemas.ts` (only if strict normalization gaps are discovered)
  - `apolles/src/features/suppliers/supplier-logger.ts` (only if adapter integration requires non-breaking helper extension)

### Testing Requirements

- Use deterministic unit tests with mocked HTTP layer and mocked `withSupplierApiLogging` behavior where useful.
- Validate both mapping correctness and failure translation (typed error codes, safe messages).
- Include malformed/partial upstream payload cases to ensure Zod boundary protection is enforced.
- Keep tests free of live external API dependencies.

### Previous Story Intelligence

- Story 2.1 established the supplier contracts and Zod-normalized output types.
- Story 2.1 added resilient logging helper behavior so logging failures do not break business flow.
- Story 2.1 code review hardened enum mapping and Prisma create typing; reuse that approach rather than adding new untyped casts.
- Story 2.1 finished with all gates passing and status `done`, so 2.2 should build directly on these stable primitives.

### Git Intelligence Summary

- Existing commit history shows a foundation-first path: scaffold -> story implementation increments.
- Current codebase conventions already use feature-based modules and co-located tests; follow this same pattern for the adapter.
- Story 1.1 foundation commit includes shared infra (`errors.ts`, `db.ts`, auth patterns) that should be reused instead of recreating utilities.

### Latest Tech Information

- Current workspace package set confirms Next.js 15, Prisma 6, Zod 3, and Vitest 4 are active; adapter code should target these versions directly.
- No additional framework or infrastructure dependencies are required for this story.
- Keep implementation compatible with existing ESM/TypeScript settings in `apolles/package.json` and `tsconfig`.

### Project Structure Notes

- No `project-context.md` detected.
- Keep runtime implementation out of `_bmad/` and `_bmad-output/`.

### References

- Story 2.2 definition and ACs [Source: `_bmad-output/planning-artifacts/epics.md:490`]
- Epic 2 scope constraints (no dedup/orchestrator, Promise.allSettled later in Story 2.5) [Source: `_bmad-output/planning-artifacts/epics.md:257`]
- Supplier adapter architecture and timeout/logging rules [Source: `_bmad-output/planning-artifacts/architecture.md:410`]
- Structure and layer boundaries [Source: `_bmad-output/planning-artifacts/architecture.md:734`]
- TBO integration and auth requirements [Source: `_bmad-output/planning-artifacts/prd.md:314`]

## Dev Agent Record

### Agent Model Used

openai/gpt-5.3-codex

### Debug Log References

- Create-story workflow context synthesis
- `pnpm test`
- `pnpm typecheck`
- `pnpm build`

### Completion Notes List

- Created comprehensive implementation context for Story 2.2 with architecture, testing, and boundary guardrails.
- Included carry-over intelligence from Story 2.1 to prevent regressions and duplicate abstractions.
- Implemented `tboAdapter.search()` with Basic Auth, request mapping, 5-second timeout, supplier logging wrapper, and typed error translation.
- Added robust response normalization into Story 2.1 `SupplierSearchResult` schema with malformed payload protection.
- Added co-located adapter tests for success, timeout, auth failure, malformed payload, empty results, and missing credentials.
- Kept non-search adapter methods interface-compatible by throwing explicit typed not-implemented errors for Story 2.2 scope.
- Code review fixes applied: normalized response handling now skips malformed hotel rows while preserving valid hotels.
- Code review fixes applied: endpoint configuration now uses a fixed Story 2.2 endpoint constant instead of raw runtime endpoint overrides.
- Code review fixes applied: credential lookup trims values and falls back to validated env import when available, while preserving typed `SUPPLIER_ERROR` for missing credentials.
- Expanded tests to cover zero-children mapping, partial malformed supplier payload handling, and `RATE_UNAVAILABLE` translation.
- Follow-up review fixes: TBO search payload now maps to a supplier-shaped `HotelSearch` request body with `RoomGuests` entries per requested room.
- Follow-up review fixes: adapter now translates TBO business failures returned inside HTTP 200 payloads into typed platform errors.
- Follow-up review fixes: adapter now throws a typed malformed-response error when all returned hotel rows are invalid instead of silently treating them as empty results.
- Follow-up review fixes: tests now cover 200-response business failures, multi-room request mapping, and fully malformed supplier payload handling.

### File List

- _bmad-output/implementation-artifacts/2-2-tbo-holidays-api-search-adapter.md
- apolles/src/features/suppliers/adapters/tbo-adapter.ts
- apolles/src/features/suppliers/adapters/tbo-adapter.test.ts

## Senior Developer Review (AI)

### Reviewer

- Moshe (AI-assisted) on 2026-03-13

### Outcome

- Changes Requested issues were fixed in-story and revalidated.
- Final decision: **Approved**

### Findings Addressed

- Fixed defensive normalization behavior to preserve valid hotels when individual hotel records are malformed.
- Removed unvalidated runtime override for search endpoint; adapter now uses fixed TBO endpoint constant for this story scope.
- Hardened credential handling with trimmed values and validated-env fallback while preserving typed application errors.
- Added missing test coverage for zero-children mapping and rate-unavailable error translation.

### Validation Evidence

- `pnpm test --run` (pass)
- `pnpm build` (pass)
- `pnpm typecheck` (pass, run after build)

- Reviewer: OpenCode
- Date: 2026-03-14
- Outcome: Approved after follow-up fixes
- Findings addressed:
  - HIGH: mapped search input into a TBO-shaped `HotelSearch` request payload instead of forwarding the internal contract shape
  - HIGH: now translates TBO business failures embedded in HTTP 200 responses into typed platform errors
  - HIGH: now fails closed when all returned hotel rows are malformed instead of silently returning an empty result set
  - MEDIUM: expanded tests to cover supplier-declared failure payloads and fully malformed hotel collections
- Validation: `pnpm test -- src/features/suppliers/adapters/tbo-adapter.test.ts` (pass)

## Change Log

- 2026-03-12: Created Story 2.2 and set status to ready-for-dev.
- 2026-03-12: Implemented TBO search adapter with timeout/logging/error translation, added adapter tests, and moved story to review.
- 2026-03-13: Completed adversarial code review fixes, expanded adapter test coverage, reran quality gates, and marked story done.
- 2026-03-14: Completed follow-up code review fixes for TBO request mapping, 200-response business-error translation, malformed-payload handling, and added targeted regression tests.
