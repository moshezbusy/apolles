# Story 1.4: Dashboard Shell with Sidebar Navigation

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an **agent**,
I want to see an authenticated dashboard with sidebar navigation,
so that I have a central workspace to access all platform features.

## Acceptance Criteria

1. **Given** I am logged in
   **When** I access any authenticated page
   **Then** I see a sidebar with navigation items: Search (active by default), Reservations
2. **Given** I am an admin user
   **When** I access the authenticated area
   **Then** I additionally see: All Bookings, Supplier Logs, Platform Settings
3. **Given** the sidebar is rendered
   **Then** it uses `#0A2540` dark background with white text
   **And** active nav item shows `#635BFF` primary text with left accent bar
4. **Given** the authenticated shell is visible
   **Then** my name and role are displayed at the sidebar bottom
   **And** logout action is available from sidebar bottom
5. **Given** I access authenticated pages without a valid session
   **Then** unauthenticated access redirects to login via Next.js middleware
6. **Given** authenticated pages are rendered
   **Then** semantic landmarks exist: `header`, `nav`, `main`
   **And** skip-to-content link is visible on first Tab press
   **And** focus indicators use 2px primary outline with 2px offset
7. **Given** viewport width is mobile (`< 768px`)
   **Then** sidebar navigation is replaced by simple header + hamburger menu

## Tasks / Subtasks

- [x] **Task 1: Build authenticated app shell and route structure** (AC: #1, #2, #5)
  - [x] Create shell components under `apolles/src/components/layout/`: `app-shell.tsx`, `sidebar.tsx`, `page-header.tsx`.
  - [x] Introduce authenticated route groups/pages for `search`, `reservations`, and admin placeholder pages (`admin/bookings`, `admin/supplier-logs`, `admin/settings`) with minimal content.
  - [x] Keep `/login` outside authenticated shell; keep auth API route intact.
  - [x] Ensure Search is the default active destination for authenticated users.

- [x] **Task 2: Implement role-aware sidebar navigation** (AC: #1, #2, #3)
  - [x] Implement agent nav items: Search, Reservations.
  - [x] Implement admin-only section: All Bookings, Supplier Logs, Platform Settings.
  - [x] Style sidebar with `#0A2540`-aligned design tokens and white text.
  - [x] Implement active state with primary color text + left accent bar.

- [x] **Task 3: Implement shell footer identity and logout** (AC: #4)
  - [x] Display session user name + role in sidebar bottom area.
  - [x] Wire logout action in shell footer to existing NextAuth sign-out flow.
  - [x] Ensure behavior works for both agent and admin roles.

- [x] **Task 4: Finalize auth gate behavior in middleware** (AC: #5)
  - [x] Confirm middleware protects all authenticated routes and excludes `/login` + `/api/auth/*`.
  - [x] Ensure unauthenticated requests redirect to login with callback URL preserved.
  - [x] Ensure authenticated users hitting `/login` are redirected to app home.

- [x] **Task 5: Accessibility and responsive navigation behavior** (AC: #6, #7)
  - [x] Add semantic landmarks (`header`, `nav`, `main`) in shell layout.
  - [x] Add keyboard-visible skip-to-content link (first Tab).
  - [x] Ensure interactive controls expose visible 2px focus outline with 2px offset (using existing global token rules).
  - [x] Implement mobile header + hamburger menu for nav under `md` breakpoint.

- [x] **Task 6: Verification and quality gates**
  - [x] Add/update tests for role-based nav visibility and auth redirect behavior where practical.
  - [x] Run `pnpm build`, `pnpm test`, `pnpm typecheck`.

## Dev Notes

- Story 1.3 already delivered auth + middleware baseline; this story should extend shell/navigation only, not re-implement credentials/auth core.
- Keep NextAuth v5 patterns (`auth()`, server components for shell, middleware auth wrapper).
- Preserve Supabase + Prisma setup; no schema changes required for this story.
- Follow established design tokens from `apolles/src/app/globals.css` (primary `#635BFF`, dark `#0A2540`, focus ring tokens).

### Technical Requirements

- **Framework pattern:** Server Components by default for layout/navigation; Client Components only for interactive hamburger toggles.
- **Navigation source of truth:** Single typed nav config that supports role filtering (agent/admin) to avoid duplicated lists.
- **Route protection:** Middleware remains enforcement point for page-level auth redirects.
- **Role handling:** Read role from session (`session.user.role`) populated by Story 1.3 auth callback.
- **Do not add** Story 1.5 authorization helpers yet (`requireAuth`, `requireRole`) unless strictly needed for shell rendering.

### Architecture Compliance

- Keep code under architecture paths:
  - `src/components/layout/` for shell components
  - `src/app/` for page/layout routes
  - `src/middleware.ts` for auth redirects
- Respect App Router boundaries:
  - Layout and static nav in Server Components
  - Hamburger/menu state in Client Component
- No supplier/business logic in this story.

### Library / Framework Requirements

- Next.js App Router (current project uses Next.js 15)
- NextAuth v5 beta APIs already adopted in project
- shadcn/ui primitives may be used for buttons/dialog/sheet-like nav if needed
- Tailwind v4 CSS-first tokens only (no tailwind.config.js additions)

### File Structure Requirements

- Expected touched/created files (implementation target):
  - `apolles/src/components/layout/app-shell.tsx`
  - `apolles/src/components/layout/sidebar.tsx`
  - `apolles/src/components/layout/page-header.tsx`
  - `apolles/src/app/page.tsx` (home behavior alignment)
  - `apolles/src/app/search/page.tsx` (placeholder shell content)
  - `apolles/src/app/reservations/page.tsx` (placeholder shell content)
  - `apolles/src/app/admin/bookings/page.tsx` (placeholder)
  - `apolles/src/app/admin/supplier-logs/page.tsx` (placeholder)
  - `apolles/src/app/admin/settings/page.tsx` (placeholder)
  - `apolles/src/middleware.ts` (only if adjustments needed)

### Testing Requirements

- Preserve and extend current Vitest setup.
- Add focused tests for:
  - Role-based nav visibility logic (agent vs admin)
  - Middleware redirect behavior remains correct for protected routes and `/login`
  - Any extracted pure helpers for nav config/state decisions

### Previous Story Intelligence (from 1.3)

- Existing middleware already preserves callback URL query string; do not regress this behavior.
- Login page auth redirect guard was removed to avoid duplication with middleware; keep middleware as the single redirect gate.
- Logout flow now calls NextAuth `signOut` directly from server action; reuse this in sidebar footer.
- Session role currently comes from NextAuth user payload in callback; avoid extra DB lookups in layout rendering.

### Git Intelligence Summary

- Recent commits are sparse (`9bf0d9e`, `eb56ab8`), so rely on current codebase conventions rather than commit cadence.
- Existing code style in active files uses concise functional components, tokenized class names, and small helper modules.
- Current worktree already contains Story 1.2/1.3 changes; implement Story 1.4 without undoing prior in-progress modifications.

### Latest Tech Information

- Auth.js (NextAuth v5) supports middleware wrapping via `export default auth((req) => ...)`; current project already uses this pattern.
- Next.js routing middleware convention is being renamed to `proxy` in v16 docs, but `middleware.ts` remains valid in current project version and should be kept for consistency.
- Auth.js docs continue to recommend generic credential failure messages for Credentials provider (already aligned in Story 1.3).

### Project Structure Notes

- Use existing `src/components/layout/` directory created in prior fixes.
- Keep `/login` as unauthenticated page; authenticated shell should wrap app pages only.
- Do not introduce agent settings nav item yet (lean MVP sidebar in current epic scope is Search + Reservations for agents).

### References

- Story definition and ACs [Source: `_bmad-output/planning-artifacts/epics.md:404`]
- Auth/session and middleware direction [Source: `_bmad-output/planning-artifacts/architecture.md:293`]
- Frontend component boundary map [Source: `_bmad-output/planning-artifacts/architecture.md:534`]
- Target project structure for layout components [Source: `_bmad-output/planning-artifacts/architecture.md:861`]
- Sidebar composition and role items [Source: `_bmad-output/planning-artifacts/ux-design-specification.md:493`]
- Accessibility and responsive requirements [Source: `_bmad-output/planning-artifacts/ux-design-specification.md:1541`]
- Previous story implementation learnings [Source: `_bmad-output/implementation-artifacts/1-3-agent-login-logout-secure-sessions.md`]

## Dev Agent Record

### Agent Model Used

openai/gpt-5.3-codex

### Debug Log References

- create-story workflow executed for next backlog item from sprint status
- source analysis: epics + architecture + ux + previous story + auth docs
- `pnpm test`
- `pnpm typecheck`
- `pnpm build`
- `pnpm test` (review remediation)
- `pnpm typecheck` (review remediation)
- `pnpm build` (review remediation)

### Completion Notes List

- Implemented authenticated app shell route group with shared layout and skip link.
- Added responsive sidebar with role-aware navigation (agent + admin sections), active state accent, and mobile hamburger menu.
- Added sidebar footer identity and logout action wired to existing NextAuth v5 sign-out server action.
- Redirected authenticated entry points to `/search` and aligned login redirect behavior to `/search`.
- Refactored middleware redirect decisions into tested pure helper (`auth-routing.ts`) while preserving callback URL behavior.
- Added nav configuration helper and unit tests for role visibility and active-route detection.
- Added placeholder pages for Search, Reservations, and admin destinations to complete shell navigation routes.
- Validation passed: `pnpm test` (23/23), `pnpm typecheck`, `pnpm build`.
- Code review remediation: added desktop sidebar header landmark, fixed skip-link keyboard visibility behavior, aligned sidebar width to 240px, and added icon-based navigation.
- Implemented collapsible desktop sidebar (240px/64px) with `localStorage` persistence and hydration-safe initialization.
- Added admin route-group layout guard so non-admin users are redirected away from `/admin/*` pages.
- Review remediation: made `pnpm typecheck` reproducible on a clean checkout by generating Next route types and disabling stale incremental cache reuse.
- Review remediation: kept user name and role visible in the collapsed desktop sidebar footer and added sidebar regression coverage.
- Review remediation: bypassed auth routing for public asset paths and extended auth-routing tests for asset handling.

### File List

- _bmad-output/implementation-artifacts/1-4-dashboard-shell-with-sidebar-navigation.md
- apolles/src/app/page.tsx
- apolles/src/app/login/actions.ts
- apolles/src/app/(app)/layout.tsx
- apolles/src/app/(app)/search/page.tsx
- apolles/src/app/(app)/reservations/page.tsx
- apolles/src/app/(app)/admin/bookings/page.tsx
- apolles/src/app/(app)/admin/supplier-logs/page.tsx
- apolles/src/app/(app)/admin/settings/page.tsx
- apolles/src/app/(app)/admin/layout.tsx
- apolles/src/components/layout/app-shell.tsx
- apolles/src/components/layout/sidebar.tsx
- apolles/src/components/layout/sidebar.test.tsx
- apolles/src/components/layout/page-header.tsx
- apolles/src/components/layout/navigation-config.ts
- apolles/src/components/layout/navigation-config.test.ts
- apolles/src/lib/auth-routing.ts
- apolles/src/lib/auth-routing.test.ts
- apolles/src/middleware.ts
- apolles/package.json
- apolles/vitest.config.ts

### Senior Developer Review (AI)

- Reviewer: Moshe
- Date: 2026-03-12
- Outcome: Approved after fixes
- Findings resolved: 2 High, 4 Medium
- Validation rerun: `pnpm test` (23/23), `pnpm typecheck`, `pnpm build`
- Reviewer: Moshe
- Date: 2026-03-14
- Outcome: Approved after automated remediation
- Findings resolved: 3 High, 2 Medium
- Git note: review began against previously committed implementation; remediation is captured in the current worktree updates above
- Validation rerun: `pnpm test` (120/120), `pnpm typecheck`, `pnpm build`

## Change Log

- 2026-03-12: Implemented Story 1.4 dashboard shell with role-aware sidebar navigation, responsive mobile menu, skip-link + semantic landmarks, and middleware redirect helper tests. Story moved to review.
- 2026-03-12: Completed adversarial code review remediation (admin route guard, sidebar accessibility/UX parity improvements, collapsible sidebar persistence) and moved story to done.
- 2026-03-14: Completed follow-up review remediation for reproducible typechecking, collapsed-sidebar identity visibility, public-asset auth bypass, and added regression coverage for sidebar/auth-routing behavior.
