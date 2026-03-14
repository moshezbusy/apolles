# Story 1.6: Admin Creates and Deactivates Agent Accounts

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the **admin**,
I want to create new agent accounts and deactivate existing ones,
so that I can manually onboard agents to the platform.

## Acceptance Criteria

1. **Given** I am logged in as admin
   **When** I navigate to Platform Settings
   **Then** I see a section for agent management with a list of agents (name, email, status, date created)
2. **And** I can click "Create Agent" to open a form: name (required), email (required), initial password (required)
3. **And** password must meet complexity: 12+ characters, uppercase, lowercase, digit, special character (NFR7)
4. **And** on successful creation, the agent appears in the list with status "Active"
5. **And** the agent's password is hashed with bcrypt before storage
6. **And** I can click "Deactivate" on an active agent, changing their status to Inactive
7. **And** I can click "Activate" on an inactive agent, restoring access
8. **And** deactivated agents cannot log in (enforced at login — Story 1.3)
9. **And** creating an agent with an existing email shows a clear error
10. **And** all fields validated with Zod on both client and server
11. **And** success toast: "Agent created" / "Agent deactivated" (auto-dismiss 4s)

## Tasks / Subtasks

- [x] **Task 1: Add admin-only agent management server actions** (AC: #1, #4, #5, #6, #7, #9, #10)
  - [x] Implement admin-protected server actions for list/create/update-active-status.
  - [x] Enforce role access via `requireRole(session, 'admin')` from `src/lib/authorize.ts`.
  - [x] Return typed action results using the existing error/result pattern.

- [x] **Task 2: Add validation and password policy enforcement** (AC: #2, #3, #9, #10)
  - [x] Define Zod schemas for create-agent payload and activation/deactivation actions.
  - [x] Validate password complexity rule (12+, upper, lower, number, special).
  - [x] Return clear duplicate-email and validation errors.

- [x] **Task 3: Build Platform Settings agent management UI** (AC: #1, #2, #4, #6, #7, #11)
  - [x] Extend Platform Settings page with agent table: name/email/status/date created.
  - [x] Add "Create Agent" dialog/form with required fields and field-level errors.
  - [x] Add Activate/Deactivate row actions and success toasts.

- [x] **Task 4: Integrate login gating for inactive accounts** (AC: #8)
  - [x] Reuse existing Story 1.3 inactive-login enforcement behavior.
  - [x] Verify no regression in login flow for active users.

- [x] **Task 5: Add tests** (AC: #3, #5, #8, #9, #10)
  - [x] Unit tests for password policy schema.
  - [x] Unit/integration tests for admin action authorization and duplicate-email handling.
  - [x] UI or action tests for activate/deactivate transitions and typed error responses.

- [x] **Task 6: Verification and quality gates**
  - [x] Run `pnpm test`.
  - [x] Run `pnpm typecheck`.
  - [x] Run `pnpm build`.

## Dev Notes

- Story 1.5 is complete and provides the canonical authorization primitives (`requireAuth`, `requireRole`, `runProtectedAction`, `buildBookingScope`). Use these instead of bespoke role checks.
- Story 1.4 already provides admin navigation entry points under Platform Settings; add agent management in that flow rather than adding new top-level routes.
- Story 1.3 already enforces inactive-account login denial. Keep this behavior intact while adding activation/deactivation controls.

### Technical Requirements

- Use `requireRole(session, 'admin')` for all admin agent-management actions.
- Keep server action sequence strict: session -> auth -> role -> validate -> execute.
- Use Zod on both client and server boundaries.
- Passwords must be bcrypt-hashed before persistence.
- Keep action responses typed and consistent with `ActionResult` patterns.

### Architecture Compliance

- Keep logic in server actions/services, not in client components.
- Reuse centralized errors from `src/lib/errors.ts`.
- Preserve role boundaries and avoid leaking admin capabilities into agent flows.
- Follow existing App Router and component conventions established in Stories 1.3-1.5.

### Library / Framework Requirements

- Next.js App Router + Server Actions
- NextAuth v5 session model
- Prisma (User model with `isActive` and role enum)
- Zod validation and bcrypt hashing
- Vitest for co-located tests

### File Structure Requirements

- **Expected updates:**
  - `apolles/src/app/(app)/admin/settings/page.tsx`
  - `apolles/src/app/login/actions.ts` (only if needed for inactive-account regression safety)
  - `apolles/src/lib/authorize.ts` (reuse only; avoid changing semantics unless required)
- **Likely new files (recommended):**
  - `apolles/src/features/admin/agents/actions.ts`
  - `apolles/src/features/admin/agents/schemas.ts`
  - `apolles/src/features/admin/agents/*.test.ts`

### Testing Requirements

- Cover admin-only access controls (agent cannot create/deactivate users).
- Cover duplicate-email create failure path.
- Cover password complexity enforcement.
- Cover activate/deactivate transitions and list refresh behavior.
- Confirm deactivated users remain blocked at login.

### Previous Story Intelligence

- Story 1.5 introduced standardized role/auth and action-result helpers; this story should consume them directly.
- Story 1.4 implemented admin shell/settings placeholders; this story should flesh out admin settings behavior instead of creating parallel UI.
- Story 1.3 stabilized auth/login/logout and inactive-account checks; preserve those semantics.

### Git Intelligence Summary

- Recent work patterns favor small typed helpers, co-located tests, and explicit status updates in story + sprint tracking.
- Current codebase already includes foundational auth, middleware, sidebar, and role-aware primitives; this story should build directly on those.

### Latest Tech Information

- Auth.js guidance remains: route middleware is not enough; enforce authorization close to data/actions.
- Next.js Server Actions should keep typed returns for UI-friendly error handling.

### Project Structure Notes

- No `project-context.md` detected.
- Keep implementation in established source tree and avoid `_bmad` or `_bmad-output` for application runtime code.

### References

- Story definition and ACs [Source: `_bmad-output/planning-artifacts/epics.md:445`]
- Epic 1 context [Source: `_bmad-output/planning-artifacts/epics.md:339`]
- Authorization constraints [Source: `_bmad-output/implementation-artifacts/1-5-simple-role-based-authorization.md`]
- Inactive login behavior [Source: `_bmad-output/implementation-artifacts/1-3-agent-login-logout-secure-sessions.md`]

## Dev Agent Record

### Agent Model Used

openai/gpt-5.3-codex

### Debug Log References

- `pnpm test`
- `pnpm test -- src/features/admin/agents/actions.test.ts src/features/admin/agents/schemas.test.ts src/features/admin/agents/agent-management-panel.test.ts src/app/login/actions.test.ts src/lib/auth-credentials.test.ts src/lib/authorize.test.ts`
- `pnpm build`
- `pnpm typecheck`

### Completion Notes List

- Implemented admin agent-management server actions for listing, creating, and toggling active status with admin role enforcement.
- Added shared Zod schemas for create and status-toggle inputs, including required password complexity constraints.
- Implemented Platform Settings agent-management UI with create dialog, client-side field validation, status controls, and success toasts.
- Added tests for schema password rules and server action behaviors (authorization, duplicate email, bcrypt hashing, status toggles).
- Verified inactive-account login gating remains intact via existing auth credential tests.
- Validation passed: `pnpm test` (50/50), `pnpm build`, `pnpm typecheck`.
- Code review follow-up fixes applied: agent listing is now restricted to AGENT role only, list action coverage added, password schema coverage expanded, and accessibility/UX improvements applied to the create-agent form.
- Review fix pass applied: deactivation now revokes active DB sessions, duplicate-email races now return a typed validation error, and the create-agent form now links field errors for assistive tech and focuses the first invalid field on submit.

### File List

- apolles/src/app/(app)/admin/settings/page.tsx
- apolles/src/features/admin/agents/actions.ts
- apolles/src/features/admin/agents/actions.test.ts
- apolles/src/features/admin/agents/agent-management-panel.tsx
- apolles/src/features/admin/agents/agent-management-form.ts
- apolles/src/features/admin/agents/agent-management-panel.test.ts
- apolles/src/features/admin/agents/schemas.ts
- apolles/src/features/admin/agents/schemas.test.ts
- _bmad-output/implementation-artifacts/1-6-admin-creates-and-deactivates-agent-accounts.md

### Senior Developer Review (AI)

- Reviewer: Moshe
- Date: 2026-03-12
- Outcome: Changes Requested (resolved in review pass)
- Findings fixed:
  - HIGH: `listAgentsAction` now filters to AGENT accounts only.
  - HIGH: Added missing `listAgentsAction` authorization/success tests.
  - MEDIUM: Improved create-agent form accessibility by wiring password helper text via `aria-describedby`.
  - MEDIUM: Expanded password schema tests for uppercase/lowercase/digit/email/name validation failures.
  - MEDIUM: Removed redundant client-side re-sorting and cleared stale form-level error on input changes.
- Verification:
  - `pnpm test` passed (50/50)
  - `pnpm typecheck` passed
  - `pnpm build` passed
- Reviewer: Moshe
- Date: 2026-03-14
- Outcome: Approved after fix pass
- Findings fixed:
  - HIGH: Deactivating an agent now revokes that user's active database sessions immediately.
  - HIGH: Duplicate-email races during agent creation now return the expected typed validation error instead of an uncaught Prisma failure.
  - MEDIUM: Create-agent field errors are now connected to inputs via `aria-describedby`.
  - MEDIUM: Invalid submit now focuses and scrolls to the first invalid field.
  - MEDIUM: Story/review completion state is now aligned with this review pass and verification.
- Verification:
  - `pnpm test -- src/features/admin/agents/actions.test.ts src/features/admin/agents/schemas.test.ts src/features/admin/agents/agent-management-panel.test.ts src/app/login/actions.test.ts src/lib/auth-credentials.test.ts src/lib/authorize.test.ts` passed
  - `pnpm typecheck` passed
  - `pnpm build` passed

## Change Log

- 2026-03-12: Created Story 1.6 with full implementation context and set status to ready-for-dev.
- 2026-03-12: Implemented Story 1.6 admin agent management with validation, role-protected actions, UI controls, and tests; moved to review.
- 2026-03-12: Completed adversarial code review fixes (HIGH/MEDIUM), re-ran quality gates, and moved story to done.
- 2026-03-14: Completed follow-up review fixes for session revocation, duplicate-email race handling, and create-agent accessibility/invalid-submit behavior; re-ran tests, typecheck, and build.
