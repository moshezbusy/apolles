# Story 1.5: Simple Role-Based Authorization

Status: in-progress

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the **platform**,
I want a simple role-check authorization module,
so that admin-only actions are protected and agents can only access their own data.

## Acceptance Criteria

1. **Given** the `requireAuth()` and `requireRole()` functions exist in `src/lib/authorize.ts`
   **When** a protected Server Action is called
   **Then** the precondition sequence is enforced: resolve session -> check auth -> check role -> validate input -> execute
2. **Given** `requireAuth(session)` is called
   **When** no session exists
   **Then** it throws `NOT_AUTHENTICATED`
3. **Given** `requireRole(session, 'admin')` is called
   **When** user is not admin
   **Then** it throws `NOT_AUTHORIZED`
4. **Given** agent queries for bookings/reservations are executed
   **Then** queries are always scoped to the agent's own `userId` (implemented as `where: { agentId: session.user.id }`)
5. **Given** admin queries for bookings/reservations are executed
   **Then** there is no agent scoping restriction
6. **Given** authorization fails
   **Then** failures return `{ success: false, error: { code: 'NOT_AUTHORIZED', message } }`
7. **Given** unit tests are run
   **Then** co-located tests cover: valid agent, valid admin, no session, wrong role

## Tasks / Subtasks

- [x] **Task 1: Implement reusable authorization helpers** (AC: #1, #2, #3)
  - [x] Create `apolles/src/lib/authorize.ts` with `requireAuth(session)` and `requireRole(session, 'admin')`.
  - [x] Ensure `requireAuth` throws typed `NOT_AUTHENTICATED` and `requireRole` throws typed `NOT_AUTHORIZED`.
  - [x] Keep role handling aligned to current runtime role enum (`AGENT` / `ADMIN`) while supporting AC semantics.

- [x] **Task 2: Enforce server action precondition order** (AC: #1, #6)
  - [x] Implement `runProtectedAction` in `apolles/src/lib/authorize.ts` with explicit sequence: session -> auth -> role -> validation -> execute.
  - [x] Define a single typed return contract for failures: `{ success: false, error: { code, message } }`.
  - [x] Map no-session to `NOT_AUTHENTICATED` and role mismatch to `NOT_AUTHORIZED`.

- [x] **Task 3: Add scoped access helpers for agent/admin data access** (AC: #4, #5)
  - [x] Add `buildBookingScope(session)` in `apolles/src/lib/authorize.ts`.
  - [x] Enforce agent scoping (`where.agentId = session.user.id`) for agent role.
  - [x] Ensure admin role is unscoped for admin-only flows.

- [x] **Task 4: Integrate helpers in current protection entry points** (AC: #1, #3, #6)
  - [x] Update `apolles/src/app/(app)/admin/layout.tsx` to consume `requireRole` for consistency.
  - [x] Keep middleware-based protection behavior unchanged and non-regressive.
  - [x] Do not duplicate role logic across files; centralize authorization checks.

- [x] **Task 5: Add co-located unit tests for authorization behavior** (AC: #7)
  - [x] Create `apolles/src/lib/authorize.test.ts` and cover valid agent, valid admin, no session, wrong role.
  - [x] Add a test that verifies validation does not execute before auth/role checks fail.
  - [x] Ensure tests are deterministic and follow existing Vitest style.

- [x] **Task 6: Verification and quality gates**
  - [x] Run `pnpm test`.
  - [x] Run `pnpm typecheck`.
  - [x] Run `pnpm build`.

## Dev Notes

- This story should introduce a centralized authz module (`authorize.ts`) and avoid scattered role checks.
- Existing auth/session foundation is already implemented in Story 1.3 (`auth.ts`, middleware integration, session role payload).
- Existing admin route guard is present from Story 1.4 and should be aligned with the new centralized helper.

### Technical Requirements

- **Precondition order is mandatory:** resolve session -> auth -> role -> validation -> execution.
- **Error contracts:** use typed errors (`NOT_AUTHENTICATED`, `NOT_AUTHORIZED`) and return typed action results for failures with shape `{ success: false, error: { code, message } }`.
- **Role model consistency:** current runtime role values are Prisma enum `AGENT`/`ADMIN`; do not introduce conflicting role strings.
- **Role API contract:** implement `requireRole(session, role)` with AC-friendly input (`'admin' | 'agent'`) and map internally to Prisma enum (`ADMIN` / `AGENT`).
- **Scoping model:** for booking/reservation queries, apply `where: { agentId: session.user.id }` for agent role; admin may query unscoped.
- **No auth regression:** do not break existing login/logout/session middleware behavior from Stories 1.3/1.4.

### Architecture Compliance

- Keep authorization helper in `apolles/src/lib/authorize.ts` as specified by epics + architecture.
- Follow existing App Router + Server Action patterns and keep checks close to data boundaries.
- Respect architecture layering: pages/layouts invoke actions/services; avoid embedding DB access in UI layers.
- Preserve typed error patterns from `apolles/src/lib/errors.ts`.

### Library / Framework Requirements

- Next.js App Router (current project baseline uses Next.js 15).
- NextAuth v5 (`auth()` session resolution patterns).
- Prisma role enums and DB session strategy.
- Zod validation after auth/role preconditions.
- Vitest for co-located unit tests.

### File Structure Requirements

- **Create:** `apolles/src/lib/authorize.ts`
- **Create:** `apolles/src/lib/authorize.test.ts`
- **Update:** `apolles/src/app/(app)/admin/layout.tsx`

### Testing Requirements

- Co-located tests in Vitest style.
- Must cover required AC scenarios:
  - valid agent auth path
  - valid admin role path
  - no session -> `NOT_AUTHENTICATED`
  - wrong role -> `NOT_AUTHORIZED`
- Add sequence guard test proving validation does not execute if auth/role preconditions fail.
- Keep tests small and pure where possible (same pattern as `auth-routing.test.ts`, `navigation-config.test.ts`).

### Previous Story Intelligence (from 1.3 and 1.4)

- Story 1.3 established stable NextAuth v5 flow with DB sessions, callback URL preservation, and secure cookie behavior.
- Story 1.4 added role-aware navigation plus admin route-group guard; this story should centralize role checks so they are reusable beyond UI routing.
- Current codebase favors pure helper modules with focused tests; follow this pattern for `authorize.ts`.

### Git Intelligence Summary

- Recent root commits indicate planning-first workflow and lean MVP alignment (`4a04c6e`, `ee331bb`, `f8e448b`, `f58e687`, `e31fcaa`).
- In-code conventions favor concise typed helpers, path aliases (`~`), and co-located Vitest tests.
- Keep changes minimal and consistent with existing style; avoid introducing new frameworks or broad refactors.

### Latest Tech Information

- Auth.js guidance: protect middleware/routes, but verify session and authorization close to data access boundaries (do not rely on middleware alone).
- Next.js Server Actions: action handlers should remain server-side (`"use server"`) and can return structured results for UI handling.
- Current project already uses middleware for route-level auth; Story 1.5 should complement this with server-action/service-level authorization.

### Project Structure Notes

- No `project-context.md` file was found in the repository.
- Current implementation does not yet include booking/reservation data actions; build reusable authorization/scoping utilities now to unblock upcoming stories.
- Maintain compatibility with existing Story 1.4 admin layout guard until feature actions adopt `requireRole` directly.

### References

- Story definition and ACs [Source: `_bmad-output/planning-artifacts/epics.md:427`]
- Authorization helper location and behavior [Source: `_bmad-output/planning-artifacts/architecture.md:305`]
- Typed error model [Source: `_bmad-output/planning-artifacts/architecture.md:386`]
- Server action precondition pattern [Source: `_bmad-output/planning-artifacts/architecture.md:645`]
- Agent/admin scoping expectations [Source: `_bmad-output/planning-artifacts/architecture.md:924`]
- UX error feedback and validation behavior [Source: `_bmad-output/planning-artifacts/ux-design-specification.md:223`]
- Previous story context [Source: `_bmad-output/implementation-artifacts/1-4-dashboard-shell-with-sidebar-navigation.md`]
- Previous auth/session context [Source: `_bmad-output/implementation-artifacts/1-3-agent-login-logout-secure-sessions.md`]

## Dev Agent Record

### Agent Model Used

openai/gpt-5.3-codex

### Debug Log References

- `pnpm test`
- `pnpm typecheck`
- `pnpm build`
- `pnpm test -- --runInBand`

### Completion Notes List

- Implemented centralized authorization helpers: `requireAuth`, `requireRole`, `buildBookingScope`, and `runProtectedAction`.
- Integrated `requireRole` into admin layout so role checks are centralized in `src/lib/authorize.ts`.
- Added full unit test coverage for required role/auth cases plus precondition-order validation guard behavior.
- Code review remediation: aligned `requireRole` semantics with architecture (admin-as-superset), added typed Zod validation failure mapping in `runProtectedAction`, and expanded tests for edge and success paths.
- Validation passed: `pnpm test` (35/35), `pnpm typecheck`, `pnpm build`.
- Follow-up remediation: `buildBookingScope()` now returns a Prisma-ready `where` clause, admin layout preserves login callback URLs for unauthenticated access, and review coverage now includes admin layout redirects plus role-failure precondition guards.
- Story remains in progress until booking/reservation queries exist and consume the scoped authorization helper in runtime code.

### Senior Developer Review (AI)

- Reviewer: Moshe
- Date: 2026-03-12
- Outcome: Approved after fixes
- Findings resolved: 1 High, 3 Medium
- Validation rerun: `pnpm test` (35/35), `pnpm typecheck`, `pnpm build`

- Reviewer: Moshe
- Date: 2026-03-14
- Outcome: Changes requested after remediation
- Findings fixed: 1 High, 2 Medium, 1 Low
- Remaining issue: booking/reservation runtime queries do not exist yet, so ACs for enforced agent/admin query scoping are still not verifiable in application code
- Validation rerun: `pnpm test -- --runInBand` (135/135), `pnpm typecheck`, `pnpm build`

### File List

- _bmad-output/implementation-artifacts/1-5-simple-role-based-authorization.md
- apolles/src/lib/authorize.ts
- apolles/src/lib/authorize.test.ts
- apolles/src/app/(app)/admin/layout.tsx
- apolles/src/app/(app)/admin/layout.test.tsx

## Change Log

- 2026-03-12: Created Story 1.5 with full implementation context and set status to ready-for-dev.
- 2026-03-12: Implemented Story 1.5 authorization module, integrated admin layout role checks, added tests, and moved story to review.
- 2026-03-12: Completed adversarial code review remediation and moved story to done.
- 2026-03-14: Re-ran code review, corrected authorization helper shape and admin login redirect handling, added regression tests, and moved story back to in-progress because runtime booking/reservation scoping is still pending.
