# Phase 1 · Plan 1b: Sign-in hardening (QR code, rate limits, unlock tool) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Close the gaps the owner chose to fix after Plan 1's security review (owner approval in chat, 2026-11-09):
1. A QR code on the admin TOTP setup page (instead of typing the key by hand).
2. Rate limiting on sign-in, TOTP, forgot-password and set-password per client IP (spec §7: "הגבלת קצב בכניסה").
3. An owner-run command that unlocks a locked account (recovery when the only admin is locked out).

**Builds on:** Plan 1 (`2026-11-08-phase1-foundation.md`), branch `claude/brave-goldberg-v7adee` (PR moshezbusy/apolles#1).
**Spec:** `docs/specs/approved/2026-11-08-apolles-design.md`. Also binding: `CLAUDE.md`.

## Global Constraints
- Everything from Plan 1's Global Constraints still holds (3-strike / 15-minute account lockout, R32/R36/R47/R48 lockout semantics, audit rows, no secrets in logs).
- Stateless servers: rate-limit state lives in Postgres, not in memory.
- A request refused by the IP rate limit is NOT counted as a failed sign-in for the account (no attempt slot is reserved).
- One new runtime dependency at most (the QR encoder), justified and audited with `supply-chain-risk-auditor`, exact pin.
- English UI copy.

---

### Task 1: QR code on the TOTP setup page

**Files:**
- Modify: `src/app/admin/2fa/setup/page.tsx` (+ a small server-only helper, e.g. `src/server/auth/totp-qr.ts`).
- Test: extend `src/app/admin-2fa.test.tsx` and add a helper test.

**Interfaces:**
- `totpQrSvgDataUri(otpauthUrl: string): Promise<string> | string` → `data:image/svg+xml;base64,...` generated on the server.

- [ ] **Step 1:** Choose the QR encoder. Candidates: `uqr` (zero dependencies) and `qrcode`. Run the `supply-chain-risk-auditor` skill on the candidates and pick one, preferring zero dependencies, active maintenance and npm provenance. Pin it exactly. Record the reasoning in the report.
- [ ] **Step 2:** Write failing tests:
    - the setup page renders an `<img>` with alt "QR code for your authenticator app" whose `src` starts with `data:image/svg+xml;base64,`;
    - the decoded SVG is a valid SVG;
    - the manual key and otpauth text are still shown below it, under "Can't scan? Enter this key instead.";
    - the confirmed admin still gets redirected.
- [ ] **Step 3:** Implement. Server-side only, with no client JS and no `dangerouslySetInnerHTML`. The setup page must send `Cache-Control: no-store`, because the QR holds the secret.
- [ ] **Step 4:** Gate: typecheck, lint, tests, build, e2e. Commit: `feat: QR code for authenticator setup`.

### Task 2: IP rate limiting

**Files:**
- Modify: `prisma/schema.prisma`, plus a migration.
- Create: `src/server/rate-limit.ts`, `src/server/client-ip.ts`.
- Modify: `src/app/login/actions.ts`, `src/app/admin/2fa/actions.ts`, `src/app/admin/2fa/setup/actions.ts`, `src/app/forgot-password/actions.ts`, `src/app/set-password/[token]/actions.ts` (or the services they call).
- Test: `src/server/rate-limit.test.ts`, `src/server/client-ip.test.ts`, plus action tests.

**Interfaces:**
- Model `RateLimitBucket { key String, windowStart DateTime, count Int, @@id([key, windowStart]), @@index([windowStart]) }`.
- `hitRateLimit(key: string, limit: number, windowMs: number): Promise<{ allowed: boolean; retryAfterMs: number }>`:
    - Uses a fixed window and one atomic `INSERT … ON CONFLICT DO UPDATE SET count = count + 1 RETURNING count`.
    - Uses the DB clock.
    - On about 1% of calls, deletes buckets older than 24 h.
- `getClientIp(headers): string`:
    - Reads `X-Forwarded-For` and takes the entry that is `TRUSTED_PROXY_HOPS` from the right (env var, default `1`; the hosting proxy appends the real client IP).
    - Falls back to `x-real-ip`, then `"unknown"`.
    - Validates the result as an IPv4/IPv6 literal, else returns `"unknown"`.
    - Document `TRUSTED_PROXY_HOPS` in `.env.example`.

**Limits:**

| Action | Limit | When refused |
|---|---|---|
| Sign-in | 10 per IP per 15 min | "Too many sign-in attempts from your network. Try again in 15 minutes." |
| TOTP verify / confirm | 10 per IP per 15 min | Same copy |
| Forgot password | 5 per IP per hour, and 3 per normalized email per hour | Silently send nothing. The page always shows the same success message. |
| Set-password submit | 10 per IP per 15 min | "Too many attempts. Try again later." The token is not consumed. |

- Key format: `<action>:ip:<ip>` and `forgot:email:<sha256(email)>`. Never store a raw email in the key.
- The rate-limit check runs before any password/TOTP verification or attempt reservation.

- [ ] **Step 1:** Write failing tests:
    - the 11th sign-in from one IP within 15 min is refused, and the account's failedLogins is unchanged;
    - a new window allows again (fake Date);
    - two parallel hits at the limit boundary → exactly one allowed;
    - the forgot-password per-email cap applies and the response stays identical;
    - `getClientIp` handles: hops, spoofed left entries, garbage, missing header;
    - the TOTP limit applies.
- [ ] **Step 2:** Implement and add the migration (`pnpm db:migrate --name rate_limit_buckets` against the dev DB).
- [ ] **Step 3:** Gate: typecheck, lint, tests, build, e2e. Commit: `feat: per-IP rate limits on sign-in and password flows`.

### Task 3: Owner unlock command

**Files:**
- Create: `src/server/auth/unlock.ts`, `prisma/unlock.ts` (a thin wrapper, same loader as `prisma/seed.ts`).
- Modify: `package.json` (script `admin:unlock`).
- Test: `src/server/auth/unlock.test.ts`.

**Interfaces:**
- `unlockUser(email: string): Promise<'UNLOCKED' | 'NOT_LOCKED' | 'NOT_FOUND'>`:
    - Normalizes the email.
    - In one transaction:
        - sets `failedLogins = 0`, `lockedUntil = null` and `attemptReservedAt = null`;
        - writes an audit row: action `user.unlock`, actor = the unlocked user's id, after `{ via: "owner-command" }`.
    - Does not touch the password, sessions or TOTP.
- `pnpm admin:unlock <email>`:
    - Prints exactly one line: `Unlocked <email>.` / `<email> was not locked.` / `No user with that email.`
    - Exit code 0, 0 or 1 respectively.
    - Prints nothing secret.
    - Validates the email with zod.

- [ ] **Step 1:** Write failing tests:
    - a locked admin → UNLOCKED, the next correct password + TOTP works;
    - a stuck row at 3 with no lock → UNLOCKED;
    - a not-locked user → NOT_LOCKED with no write and no audit row;
    - an unknown email → NOT_FOUND;
    - the audit row is written.
- [ ] **Step 2:** Implement.
- [ ] **Step 3:** Gate. Commit: `feat: owner command to unlock a locked account`.
