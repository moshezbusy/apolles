# Phase 1 · Plan 1: Foundation (auth, agencies, wallet ledger, admin) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployable app where the admin creates agencies, agents set a password and sign in, and every agency has a ledger-based USD wallet the admin can credit from bank transfers. There is no Expedia yet.

**Architecture:** One Next.js App Router app at the repo root (web UI and server actions), with a service layer that owns all DB access. Server actions call services, services call Prisma. Auth uses custom DB sessions, not a framework. The wallet is an append-only ledger and the balance is always the sum of its entries.

**Tech Stack:**
- Next.js (App Router), TypeScript strict, Tailwind, Prisma + PostgreSQL 16, pnpm.
- Vitest (unit and DB tests), Playwright (e2e).
- `@node-rs/argon2`, `otplib`, `zod`.
- Versions: latest stable at scaffold time, pinned **exact** in `package.json`.

**Spec:** `docs/specs/approved/2026-11-08-apolles-design.md` (already committed). Also binding: `CLAUDE.md`.

**Later plans (not this one):**
- Plan 2: Expedia adapter, content sync and search.
- Plan 3: booking, voucher, invoice and cancellation.
- Plan 4: emails, reconciliation, staging and launch.

## Global Constraints

- Only roles `ADMIN` and `AGENT`. One agent user per agency in phase 1. The schema allows more later.
- All money is integer **cents** (`Int`) plus `currency` (`"USD"` only in phase 1). Never `float`.
- The wallet balance is never stored or edited. Balance = `SUM(LedgerEntry.amountCents)` for the agency.
- Ledger entry types: `TOPUP_BANK`, `HOLD`, `HOLD_RELEASE`, `CHARGE`, `REFUND`, `PAYOUT`, `ADJUSTMENT`. Sign convention: credits positive, debits negative.
- No negative available balance and no agency credit.
- Sign-in:
    - 3 failed attempts lock the account for **15 minutes** and email the admin.
    - Sessions end **12 hours** after creation, with no "remember me".
    - Password: min 8 chars, letters and numbers.
- Set-password and reset links: valid **60 minutes**, single use. "Forgot password" shows the same message whether or not the email exists.
- A password change or a suspension deletes all of that user's sessions.
- Admin requires TOTP (authenticator app) on every sign-in.
- Every admin action writes an `AuditLog` row: actor, action, target, before/after JSON, time.
- Every agent-facing query is scoped by `agencyId` from the session. Never take `agencyId` from the request.
- Agent UI is English only.
- `package.json` must have `packageManager` (pnpm) and the scripts `typecheck`, `lint`, `test`, `build`. CI fails without them.
- Never read or print `.env*`. Document every variable in `.env.example`.

## Review Focus

1. **Two holds racing on one wallet** (double click, two tabs) must never overdraw. One succeeds and the other gets `InsufficientFunds`. Test in Task 3.
2. **The same ledger operation sent twice** with one idempotency key creates one entry, and the retry returns the original. Test in Task 3.
3. **An agent opening another agency's record by changing the id** gets "not found", never the data. Test in Task 7.
4. **A suspended agency's agent with an open session** loses access on the next request, not after 12 hours. Test in Task 8.
5. **A reset or set-password link used twice, or after 60 minutes**, shows the expired state and does not change the password. Test in Task 5.

---

### Task 0: Repo housekeeping (needs owner approval in chat for the CI edit)

**Files:**
- Delete the dead submodule pointer: `git rm --cached apolles`. The gitlink at path `apolles` has no `.gitmodules`.
- (Done 8.11.2026) `docs/specs/approved/2026-11-08-apolles-design.md` and `docs/research/` are already committed.
- Modify (**owner approval required**, guarded file): `.github/workflows/guardrails.yml`. Add a `postgres:16` service to job `app` and set `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/apolles_test` for the test step.

- [ ] **Step 1:** Run `echo guardrail-canary`. Expected: BLOCKED. If it runs, stop and tell the owner.
- [ ] **Step 2:** Remove the gitlink and commit: `chore: remove dead submodule pointer`.
- [ ] **Step 3:** Show the owner the CI diff in chat and apply it only after the owner approves. Commit: `ci: add postgres service for DB tests`.

### Task 1: Scaffold the app

**Files:**
- Create: `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `next.config.ts`, `src/app/layout.tsx`, `src/app/page.tsx`.
- Create: `vitest.config.ts`, `playwright.config.ts`, `.env.example`, `.npmrc`.

**Interfaces:**
- Produces: the scripts `typecheck` (`tsc --noEmit`), `lint`, `test` (`vitest run`), `build` (`next build`), `test:e2e` (`playwright test`), and `db:migrate` (`prisma migrate dev`).

- [ ] **Step 1:** Scaffold with `pnpm create next-app` (TypeScript, App Router, Tailwind, ESLint, `src/`), then pin every dependency to an exact version.
- [ ] **Step 2:** `tsconfig.json`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`.
- [ ] **Step 3:** `.npmrc`: `save-exact=true`. `package.json`: `"packageManager": "pnpm@<exact>"`.
- [ ] **Step 4:** Add `src/app/page.tsx`, which redirects to `/login`. Write a smoke test `src/app/page.test.ts` that asserts the redirect target is `/login`.
- [ ] **Step 5:** Run `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. Expected: all pass.
- [ ] **Step 6:** Commit: `feat: scaffold Next.js app`.

### Task 2: Database schema and test harness

**Files:**
- Create: `prisma/schema.prisma`, `src/server/db.ts`, `src/test/db.ts`.
- Test: `src/server/db.test.ts`.

**Interfaces:**
- Produces:
    - Models:
        - `Agency { id, name, country (ISO-2), status: ACTIVE|SUSPENDED, bankReference (unique, e.g. "APL-1042"), logoUrl?, phone?, email?, createdAt }`
        - `User { id, agencyId?, role: ADMIN|AGENT, email (unique, lowercase), name, passwordHash?, failedLogins Int, lockedUntil?, totpSecret?, status: ACTIVE|SUSPENDED, createdAt }`
        - `Session { id, tokenHash (unique), userId, expiresAt, createdAt }`
        - `PasswordToken { id, tokenHash (unique), userId, purpose: SET|RESET, expiresAt, usedAt? }`
        - `LedgerEntry { id, agencyId, type, amountCents Int, currency, holdId?, bookingRef?, reason, actorUserId?, idempotencyKey (unique), createdAt }`
        - `AuditLog { id, actorUserId, action, targetType, targetId, before Json?, after Json?, createdAt }`
    - Indexes: `LedgerEntry(agencyId, createdAt)`, `Session(userId)`, `AuditLog(targetType, targetId)`.
    - `db` (Prisma singleton) in `src/server/db.ts`.
    - `resetTestDb(): Promise<void>` in `src/test/db.ts` (truncates all tables).

- [ ] **Step 1:** Write `db.test.ts`: creating two `User`s with the same email (different case) fails. Normalize to lowercase in the service, and back it with a unique index.
- [ ] **Step 2:** Run `pnpm test src/server/db.test.ts`. Expected: FAIL (no schema).
- [ ] **Step 3:** Write the schema and the first migration (`pnpm db:migrate --name init`).
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: initial schema`.

### Task 3: Wallet ledger service

**Files:**
- Create: `src/server/wallet/ledger.ts`, `src/server/wallet/errors.ts`.
- Test: `src/server/wallet/ledger.test.ts`.

**Interfaces:**
- Consumes: `db`, `LedgerEntry`.
- Produces:
    - `getBalance(agencyId: string): Promise<{ balanceCents: number; heldCents: number }>`. `heldCents` = the sum of open holds (a HOLD with no matching release or capture).
    - `credit(input: { agencyId; type: 'TOPUP_BANK'|'REFUND'|'ADJUSTMENT'; amountCents: number; reason: string; actorUserId?: string; idempotencyKey: string; bookingRef?: string }): Promise<LedgerEntry>`
    - `debit(input: { agencyId; type: 'PAYOUT'|'ADJUSTMENT'; amountCents; reason; actorUserId; idempotencyKey }): Promise<LedgerEntry>`
    - `placeHold(input: { agencyId; amountCents; bookingRef: string; idempotencyKey }): Promise<{ holdId: string }>` throws `InsufficientFunds`.
    - `releaseHold(holdId: string, idempotencyKey: string): Promise<void>`
    - `captureHold(holdId: string, idempotencyKey: string): Promise<void>`
    - `listEntries(agencyId: string, cursor?: string, take = 50)`
    - Errors: `InsufficientFunds`, `HoldNotOpen`, `InvalidAmount`.
- Rules:
    - Every write runs in one transaction that first runs `SELECT id FROM "Agency" WHERE id = $1 FOR UPDATE`.
    - Amounts must be integers > 0. The sign is applied by type.
    - `captureHold` writes `HOLD_RELEASE(+X)` and `CHARGE(-X)` in the same transaction.
    - A repeated `idempotencyKey` returns the existing result and writes nothing.

- [ ] **Step 1: Write the failing tests:**
    - `credit 100000 then getBalance → { balanceCents: 100000, heldCents: 0 }`
    - `placeHold 30000 → balance 70000, held 30000`
    - `captureHold → balance 70000, held 0; entries are HOLD -30000, HOLD_RELEASE +30000, CHARGE -30000`
    - `releaseHold → balance 100000, held 0`
    - `placeHold over available throws InsufficientFunds and writes nothing`
    - `two concurrent placeHold of 60000 on a 100000 balance (Promise.allSettled) → exactly one fulfilled, one InsufficientFunds`
    - `credit twice with the same idempotencyKey → one entry`
    - `captureHold on a released hold throws HoldNotOpen`
    - `amountCents 0, negative or 10.5 → InvalidAmount`
- [ ] **Step 2:** Run `pnpm test src/server/wallet`. Expected: FAIL.
- [ ] **Step 3:** Implement `ledger.ts` per the rules above.
- [ ] **Step 4:** Run the tests. Expected: all PASS, including the concurrency test, 5 runs in a row (`--repeat 5` or a loop).
- [ ] **Step 5:** Commit: `feat: wallet ledger with holds and idempotency`.

### Task 4: Passwords, sessions, sign-in with lockout

**Files:**
- Create: `src/server/auth/password.ts`, `src/server/auth/session.ts`, `src/server/auth/login.ts`, `src/server/auth/guards.ts`.
- Create: `src/app/login/page.tsx`, `src/app/login/actions.ts`, `src/app/logout/route.ts`.
- Test: `src/server/auth/*.test.ts`.

**Interfaces:**
- Produces:
    - `hashPassword(p: string): Promise<string>` (argon2id) and `verifyPassword(hash, p): Promise<boolean>`.
    - `isValidPassword(p: string): boolean`: ≥ 8 chars, at least one letter and one digit.
    - `createSession(userId): Promise<string /* raw token */>`. Stores the sha256 of the token. `expiresAt = createdAt + 12h`.
    - `getSession(rawToken): Promise<{ user, agency? } | null>`. Returns null if the session expired, the user or agency is suspended, or the agency is missing for an AGENT.
    - `destroyUserSessions(userId): Promise<void>`.
    - `login(email, password): Promise<{ ok: true; userId; needsTotp: boolean } | { ok: false; reason: 'INVALID' | 'LOCKED' | 'SUSPENDED' }>`.
    - `requireAgent(): Promise<{ userId; agencyId }>` and `requireAdmin(): Promise<{ userId }>`. Both redirect to `/login` when there is no valid session. `requireAdmin` also requires TOTP to be verified for the session.
    - Cookie `apl_session`: httpOnly, Secure, SameSite=Lax, Path=/, maxAge 12h.
- Lockout: the 3rd consecutive failure sets `lockedUntil = now + 15m` and calls `notifyAdminLockout(user)` (Task 5 email port). A success resets `failedLogins`. While locked, return `LOCKED` even with the right password.
- Copy:
    - `INVALID` → "Wrong email or password."
    - `LOCKED` → "Too many attempts. Try again in 15 minutes, or reset your password."
    - `SUSPENDED` → "This account is suspended. Contact support."

- [ ] **Step 1: Write the failing tests:**
    - `wrong password ×3 → third returns LOCKED and notifyAdminLockout called once`
    - `correct password while locked → LOCKED`
    - `after 15 minutes (fake timers) → correct password ok`
    - `unknown email → INVALID (same as wrong password)`
    - `session older than 12h → getSession null`
    - `suspended agency → getSession null`
    - `isValidPassword: 'abcdefg1' true, 'abcdefgh' false, 'abc1' false`
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. Login page states per mockup `04-login.html`, without the "Mockup demo only" box.
- [ ] **Step 4:** Run the tests. Expected: PASS. Then run `pnpm typecheck && pnpm lint`.
- [ ] **Step 5:** Commit: `feat: sign-in, sessions, lockout`.

### Task 5: Email port, set-password and reset links

**Files:**
- Create: `src/server/email/port.ts`, `src/server/email/console.ts`, `src/server/email/postmark.ts`.
- Create: `src/server/auth/password-tokens.ts`.
- Create: `src/app/forgot-password/*`, `src/app/set-password/[token]/*`.
- Test: `src/server/auth/password-tokens.test.ts`.

**Interfaces:**
- Produces:
    - `sendEmail(msg: { to: string; subject: string; text: string; html?: string }): Promise<void>`. The adapter is chosen by `EMAIL_PROVIDER=console|postmark`. Console is the default in dev and test.
    - `issuePasswordToken(userId, purpose: 'SET'|'RESET'): Promise<string /* raw */>`. The link is `${APP_URL}/set-password/<raw>`, valid 60 min.
    - `consumePasswordToken(raw, newPassword): Promise<'OK' | 'EXPIRED' | 'INVALID_PASSWORD'>`. On OK: set the hash, mark the token used, and call `destroyUserSessions`.
    - `requestReset(email): Promise<void>`. Always resolves the same way, and emails only when the user exists and is active.
    - `notifyAdminLockout(user)`: emails `ADMIN_ALERT_EMAIL`.
- Copy: the success message after "Forgot password" is "If an account exists for this email, we sent a reset link." The page has one form for both purposes. The title is "Set your password" (SET) or "Create a new password" (RESET), per mockup 06.

- [ ] **Step 1: Write the failing tests:**
    - `token used twice → second EXPIRED and password unchanged`
    - `token after 61 minutes → EXPIRED`
    - `consume OK → all sessions of user deleted`
    - `requestReset unknown email → resolves, sendEmail not called`
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement and wire the pages (expired state with "Send a new link"; button disabled until valid).
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: password set/reset links and email port`.

### Task 6: Admin TOTP

**Files:**
- Create: `src/server/auth/totp.ts`, `src/app/admin/2fa/*`.
- Test: `src/server/auth/totp.test.ts`.

**Interfaces:**
- Produces:
    - `startTotpEnrollment(userId): Promise<{ otpauthUrl: string }>`
    - `confirmTotp(userId, code): Promise<boolean>`
    - `verifyTotpForSession(sessionId, code): Promise<boolean>` (marks the session `totpVerifiedAt`; this adds a column to `Session`).
- An admin without `totpSecret` is forced to `/admin/2fa/setup` after sign-in. An admin with one is forced to `/admin/2fa`. Every `/admin/*` route goes through `requireAdmin`.
- Seed: `prisma/seed.ts` creates the first admin from `SEED_ADMIN_EMAIL`, with no password. It prints nothing secret and sends a SET link by email.

- [ ] **Step 1: Write the failing tests:**
    - `admin session without totpVerifiedAt → requireAdmin redirects to /admin/2fa`
    - `wrong code → false and session stays unverified`
    - `valid code (otplib generated) → true`
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: admin TOTP`.

### Task 7: Agency-scoped data access

**Files:**
- Create: `src/server/scope.ts`.
- Test: `src/server/scope.test.ts`.

**Interfaces:**
- Produces: `forAgency(agencyId: string)`, which returns query helpers that always add `where: { agencyId }`. Phase 1 helpers: `ledger.list(cursor?)` and `ledger.get(id)`. Plans 2 and 3 add booking helpers here.
- Rule: no agent-facing server action calls `db` directly. A lint rule (`no-restricted-imports` of `@/server/db` outside `src/server/**`) enforces it.

- [ ] **Step 1: Write the failing tests:**
    - `agency A agent requesting agency B ledger entry id → null`
    - `importing @/server/db from src/app/** fails lint` (an eslint RuleTester or a fixture file run through `pnpm lint`)
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement `forAgency` and the lint rule.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: agency-scoped access and lint guard`.

### Task 8: Admin, agencies and agents

**Files:**
- Create: `src/server/admin/agencies.ts`, `src/server/audit.ts`, `src/app/admin/agencies/*`.
- Test: `src/server/admin/agencies.test.ts`.

**Interfaces:**
- Produces:
    - `audit(actorUserId, action, targetType, targetId, before?, after?): Promise<void>`
    - `createAgency(actor, { name, country, agentName, agentEmail }): Promise<{ agencyId; userId }>`. Assigns a unique `bankReference` `APL-<4+ digits>` and sends a SET email to the agent.
    - `setAgencyStatus(actor, agencyId, 'ACTIVE'|'SUSPENDED')`. On suspend: `destroyUserSessions` for all of its users.
    - `listAgencies(cursor?)`, with the balance of each from `getBalance`.
- Every function calls `requireAdmin` in its server action and writes `audit`.

- [ ] **Step 1: Write the failing tests:**
    - `createAgency → agency + AGENT user + SET email sent + audit row`
    - `duplicate agentEmail → error "A user with this email already exists"`
    - `suspend → agent's existing session getSession null on next call + audit row with before/after status`
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement the service and the admin pages (list, create form, suspend/reactivate with confirm).
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: admin agencies`.

### Task 9: Admin money actions

**Files:**
- Create: `src/server/admin/money.ts`, `src/app/admin/agencies/[id]/wallet/*`.
- Test: `src/server/admin/money.test.ts`.

**Interfaces:**
- Consumes: the Task 3 ledger and Task 8 `audit`.
- Produces:
    - `confirmBankTopup(actor, { agencyId, amountCents, bankTransferRef, receivedOn }): Promise<LedgerEntry>`. Uses `idempotencyKey = "topup:" + bankTransferRef`.
    - `recordPayout(actor, { agencyId, amountCents, note })`: a debit of type PAYOUT. It cannot exceed the available balance.
    - `recordAdjustment(actor, { agencyId, amountCents /* signed */, reason /* required, ≥ 5 chars */ })`
- UI: the agency wallet page shows the balance, held amount and ledger history, with three forms. Each form asks for confirmation with the amount in USD.

- [ ] **Step 1: Write the failing tests:**
    - `same bankTransferRef twice → one entry`
    - `payout above available → InsufficientFunds`
    - `adjustment without reason → validation error`
    - `each action writes an audit row`
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: admin top-ups, payouts, adjustments`.

### Task 10: Agent shell and balance page

**Files:**
- Create: `src/app/(agent)/layout.tsx`, `src/app/(agent)/balance/page.tsx`, `src/components/Header.tsx`.
- Test: `e2e/foundation.spec.ts`.

**Interfaces:**
- Consumes: `requireAgent`, `forAgency(...).ledger.list`, `getBalance`.
- The header follows mockup `07-search.html`. Search, Quotes and Reporting are shown disabled ("Coming soon"). Bookings comes in plan 3. The balance links to `/balance`. The agency menu has Balance & top-ups and Sign out.
- Balance page (mockup 20, Balance tab, phase 1 parts only):
    - balance and held amounts;
    - ledger history with the balance after each row;
    - bank transfer details from `BANK_DETAILS_*` env vars plus the agency's `bankReference`;
    - the note "Top-ups are credited after Apolles confirms the transfer. USD only."
    - No card top-up.

- [ ] **Step 1:** Write the e2e test `foundation.spec.ts`. It runs against `pnpm dev` with the console email adapter and reads the link from a test-only mail sink:
    1. The admin signs in with TOTP.
    2. The admin creates agency "Test Travel" with agent `agent@test.local`.
    3. The agent opens the SET link, sets `Passw0rd1`, signs in, and sees "USD 0.00".
    4. The admin confirms a USD 1,000.00 top-up.
    5. The agent reloads and sees "USD 1,000.00" and one "Top-up · bank transfer" row.
    6. The agent opens `/admin`. Expected: redirect to `/login` or 404.
- [ ] **Step 2:** Run `pnpm test:e2e`. Expected: FAIL.
- [ ] **Step 3:** Implement the layout, header and balance page.
- [ ] **Step 4:** Run `pnpm test:e2e` and the full `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. Expected: all PASS.
- [ ] **Step 5:** Commit: `feat: agent shell and balance page`. Open a PR and run `/security-review` and the `differential-review` skill on it (auth and money).

---

## Self-review notes

- **Spec coverage (plan 1 scope):**
    - Section 2: roles and USD covered.
    - Section 3: rows 1, 2, 3, 13 and 14 (agencies, top-ups, payouts, audit) covered. "All bookings" and "supplier log" move to plans 3 and 2.
    - Section 4: ledger rules covered. Booking use of holds is in plan 3.
    - Section 7: auth, isolation and tests covered. Hosting and backups move to plan 4.
- **Not covered here by design:** Expedia, search, booking, voucher, invoices, the invoicing provider, most emails, staging deploy.
- **Type consistency:** `holdId`, `bookingRef` and `idempotencyKey` are named the same in Tasks 2, 3 and 9. `requireAgent` returns `{ userId, agencyId }` everywhere.
