# Design System: Restyle Phase-1 Pages to the Mockups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every page that exists today (sign-in, password, admin 2FA, admin agencies and wallet, agent shell and balance) looks like the owner's mockups (`Apolles-Mockups.zip`: pages 04, 05, 06, 07, 13, 20). No new features, no change to behavior.

**Architecture:** The mockup's colors and fonts become Tailwind theme tokens in `src/app/globals.css`. Repeated class strings (button, input, card, alert, table) live in one module, `src/components/ui.ts`. Sign-in-style pages share one `AuthShell` component. Pages keep their server logic, labels and button names; only markup and classes change.

**Tech Stack:** Next.js App Router, Tailwind v4 (`@theme`), Vitest (render-to-string page tests), Playwright e2e. No new packages.

**Spec:** `docs/specs/approved/2026-11-08-apolles-design.md` (section 3: phase-1 scope; "no public home page or join form"). The mockups are the visual source. Owner, in chat on 2026-11-10: "start as is, do everything, don't wait for my approvals". Admin pages have no mockup: they reuse the agent-side style.

## Global Constraints

- Tokens copied verbatim from the mockups: ink `#17211d`, muted `#6d756f`, green `#173f35`, green-2 `#245c4e`, line `#e7e2d8`, cream `#f7f4ed`, paper `#fffdf8`, gold `#b89155`, green-soft `#eef3f0`, page background `#faf9f6`.
- Headings and the wordmark use `Georgia, "Times New Roman", serif`, weight 500. Body uses `Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` (system fonts only; no font download, no new package).
- Light theme only. The `prefers-color-scheme: dark` block is removed (root cause of the faint table text on staging).
- Phase-1 scope wins over the mockups. Leave out: "Join Apolles", "Apply for access", Quotes / Reporting menus with items, the new-device email code step, footer links to pages that do not exist.
- Every existing label, button name, heading and copy constant that a test or e2e step uses stays word for word (`Email`, `Password`, `Sign in`, `Continue`, `Review`, `Confirm top-up`, `Set your password`, `Apolles Admin`, "Coming soon" ×3, etc.).
- Agent UI English only. No `float` money: amounts still come from `formatUsd`.

## Review Focus

1. **Dark mode on the owner's Mac:** the table text must be dark on white. Test: `globals.css` has no `prefers-color-scheme` rule (Task 1).
2. **A test that matches copy:** a renamed label silently breaks the e2e flow. Mitigation: no label/button/heading renames; full unit suite plus `pnpm build` after every task.
3. **The suspended / locked / expired messages** still render with `role="alert"` / `role="status"` (screen readers and tests rely on them). Covered by the existing page tests.
4. **Narrow screens:** tables keep `overflow-x-auto` so a phone can scroll them.
5. **The 2FA pages** must not gain the admin menu (half-signed-in admin). They use `AuthShell`, which has no nav (Task 2).

---

### Task 1: Tokens, primitives and the dark-mode fix

**Files:**
- Modify: `src/app/globals.css`, `src/app/layout.tsx`
- Create: `src/components/ui.ts`, `src/app/globals-css.test.ts`

**Interfaces:**
- Produces: Tailwind colors `ink`, `muted`, `brand` (= green), `brand-2`, `line`, `cream`, `paper`, `gold`, `brand-soft`, `canvas` (= `#faf9f6`); font `font-serif`.
- Produces `src/components/ui.ts` string constants: `btnPrimary`, `btnSecondary`, `btnDanger`, `link`, `input`, `label`, `card`, `alertError`, `alertInfo`, `alertSuccess`, `tableWrap`, `table`, `th`, `td`, `pageTitle`, `eyebrow`.

- [ ] **Step 1: Write the failing test** `globals-css.test.ts`: reads `src/app/globals.css`; expects no `prefers-color-scheme`; expects `--color-brand: #173f35` and `--color-ink: #17211d`.
- [ ] **Step 2:** `pnpm vitest run src/app/globals-css.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Rewrite `globals.css` with the `@theme` tokens, remove the dark block, set the body background to `canvas` and the text to `ink`. Add `src/components/ui.ts`.
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5:** Commit `feat(ui): mockup design tokens; remove dark mode`.

### Task 2: Auth shell and the sign-in-style pages

**Files:**
- Create: `src/components/AuthShell.tsx`
- Modify: `src/app/login/page.tsx`, `login-form.tsx`, `src/app/forgot-password/*.tsx`, `src/app/set-password/[token]/*.tsx`, `src/app/admin/2fa/page.tsx`, `code-form.tsx`, `setup/page.tsx`
- Test: `src/app/password-pages.test.tsx`, `src/app/admin-2fa.test.tsx` (existing, must stay green)

**Interfaces:**
- Produces: `AuthShell({ eyebrow?: string; title?: string; subtitle?: string; wide?: boolean; children })`. It draws the mockup-04 header (wordmark only), the centered 430px card (520px when `wide`), and the dark footer (wordmark + "Hotel booking tools for verified travel professionals."). No nav, no links out.

- [ ] **Step 1:** Add a test to `password-pages.test.tsx`: the login page renders the eyebrow "Sign in" and the note "For your security, you are signed out automatically after 12 hours.".
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Build `AuthShell`; move the pages onto it. Login: eyebrow "Sign in", title "Welcome back", subtitle "Sign in to your Apolles account.", "Forgot password?" next to the Password label, and the 12-hour note under the button. Forms use the `ui.ts` constants.
- [ ] **Step 4:** `pnpm test`. Expected: all PASS.
- [ ] **Step 5:** Commit `feat(ui): auth pages in the mockup style`.

### Task 3: Admin console

**Files:**
- Modify: `src/components/AdminHeader.tsx`, `src/app/admin/agencies/page.tsx`, `new/page.tsx`, `create-form.tsx`, `[id]/confirm/page.tsx`, `[id]/wallet/page.tsx`, `[id]/wallet/wallet-forms.tsx`
- Test: `src/app/admin-pages.test.tsx` (existing)

- [ ] **Step 1:** Add a test: the agencies table body cells use the `td` constant (dark text), so no cell inherits a light color.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Header like mockup 07 (68px, white, serif "Apolles" wordmark plus a small "Admin" tag so the text "Apolles Admin" stays, active-tab underline). Tables like mockup 13 (uppercase 11px headers, 18px-radius white card). Status pills like mockup 13. Forms and confirm page on the `ui.ts` constants.
- [ ] **Step 4:** `pnpm test`. Expected: all PASS.
- [ ] **Step 5:** Commit `feat(ui): admin console in the mockup style`.

### Task 4: Agent header and balance page

**Files:**
- Modify: `src/components/Header.tsx`, `src/app/(agent)/balance/page.tsx`
- Test: `src/app/agent-pages.test.tsx` (existing)

- [ ] **Step 1:** Add a test: the header's balance chip shows the small label "Balance" above the amount (mockup 07).
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Header like mockup 07: wordmark, Search / Quotes / Reporting greyed with "Coming soon", the balance chip, and an avatar with the agency's initials in front of the agency menu. Balance page: serif title, two balance cards, the bank-transfer card, and the history table in the mockup-13 table style.
- [ ] **Step 4:** Run the whole suite plus `pnpm typecheck && pnpm lint && pnpm build`. Expected: all PASS.
- [ ] **Step 5:** Commit `feat(ui): agent shell and balance in the mockup style`.

### Task 5: Visual check and e2e

- [ ] **Step 1:** Run the app locally against the test database, seed an admin and an agency, and take screenshots of every page. Compare them with the mockups.
- [ ] **Step 2:** Run `pnpm test:e2e`. Expected: PASS. If the e2e needs services this container lacks, report that it was not run.
- [ ] **Step 3:** Push, then code review (`requesting-code-review`).
