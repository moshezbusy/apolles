# Agency Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The agent edits their own agency's profile (name, business email, phone, country, logo) at `/settings`. The voucher in plan 3 reads these details.

**Architecture:**
- **Service:** `src/server/agency-profile.ts`. Every function takes `agencyId` from the session and writes an `AuditLog` row in the same transaction as the change.
- **Logo storage:** a new table `AgencyLogo`, one row per agency, holding the bytes. The unused `Agency.logoUrl` column is dropped.
- **Logo delivery:** the route `/settings/logo` serves the logo of the signed-in agent's agency only.
- **Shared code:** an ISO country list in `src/lib/countries.ts`; PNG/JPEG checks in `src/lib/image-info.ts`.

**Tech Stack:** Next.js server actions, Prisma, Zod, Vitest. No new packages.

**Spec:** approved design 2026-11-08, section 7א ("Agency profile tab (name, logo, phone, email, country) moves to phase 1, because the voucher needs it"). Mockup 20, Agency profile tab. Owner, 2026-11-10: build without stopping for questions.

## Global Constraints
- **Fields:** exactly name, business email, phone, country and logo. The mockup's address and website are not in the spec.
- **Validation:**
    - name: trimmed, 2–100 characters (same rule as `createAgencyInput`).
    - country: ISO 3166-1 alpha-2, from `COUNTRY_CODES`.
    - email: trimmed, ≤ 254 characters, valid email.
    - phone: trimmed; may start with `+`; only digits, spaces, `-`, `(` and `)`; 7–15 digits in total.
    - All five are required on save. Zod is strict: unknown fields are rejected.
- **Logo:**
    - PNG or JPEG only. The type is detected from the file's bytes, never from its name or the browser's claim. SVG is rejected because it can carry script.
    - Size ≤ 512,000 bytes.
    - Width 300–4,000 px, height 1–4,000 px, read from the PNG IHDR or the JPEG SOF header.
- **Scope and audit:**
    - `agencyId` comes only from `requireAgent()`, never from the request.
    - Audit actions: `agency.profile.update` (before/after values of the 4 fields), `agency.logo.set` (sha256, size, width, height; never the bytes), `agency.logo.remove`.
- **The logo route's response headers:**
    - `Content-Type`: the stored type
    - `X-Content-Type-Options: nosniff`
    - `Content-Security-Policy: default-src 'none'; sandbox`
    - `Cache-Control: private, no-cache`
    - `ETag`: the sha256
- **Agent UI:** English only, in the mockup style (`src/components/ui.ts`).

## Review Focus
1. **Another agency's data:** an agent never reads or changes another agency's profile or logo, because there is no id in the request. Tested in Task 2 (service) and Task 3 (route).
2. **A file named `.png` that is really HTML or SVG** is rejected. Tested in Task 1.
3. **A huge or truncated image header** is rejected and never crashes the parser. Tested in Task 1.
4. **A suspended agency's agent** loses access on the next request. `requireAgent` already covers this; the route and the actions call it.
5. **Uploading the same logo twice** creates no second row; the existing row is replaced. Tested in Task 2.

---

### Task 1: Country list and image checks
- Create: `src/lib/countries.ts`, `src/lib/image-info.ts` and their tests.
- `COUNTRY_CODES: readonly string[]` (ISO 3166-1 alpha-2) and `countryName(code: string): string` (English, through `Intl.DisplayNames`).
- `readImageInfo(bytes: Uint8Array): { type: "image/png" | "image/jpeg"; width: number; height: number } | null`. Returns null for anything that is not a well-formed PNG or JPEG header.
- [ ] Failing tests: PNG and JPEG headers return their size; SVG, HTML and GIF bytes return null; truncated headers return null; the country list holds IL, US and GB, and `countryName("IL") === "Israel"`.
- [ ] Implement → green → commit.

### Task 2: Schema and service
- Migration `agency_logo`: create table `AgencyLogo` (`agencyId` PK/FK, `mimeType`, `data` bytea, `sizeBytes`, `width`, `height`, `sha256`, `updatedAt`); drop `Agency.logoUrl`.
- `src/server/agency-profile.ts`:
    - `agencyProfileInput` (Zod)
    - `getAgencyProfile(agencyId)`
    - `updateAgencyProfile(actor, agencyId, input)`
    - `setAgencyLogo(actor, agencyId, bytes)` → `{ ok: true } | { ok: false; error: string }`
    - `removeAgencyLogo(actor, agencyId)`
    - `getAgencyLogo(agencyId)`
- [ ] Failing DB tests:
    - an update writes the fields and an audit row with before/after;
    - invalid input throws;
    - updating agency A never changes agency B;
    - a logo is stored with its sha256, a second logo replaces it, and the audit row has no bytes;
    - an SVG or an oversized file → `{ ok: false }` and nothing is stored;
    - remove deletes the logo and audits.
- [ ] Implement → green → commit.

### Task 3: Page, actions, logo route and header link
- `src/app/(agent)/settings/page.tsx`, `actions.ts`, `profile-form.tsx`, `logo-form.tsx`.
- `src/app/(agent)/settings/logo/route.ts`.
- The header's agency menu gets an "Agency settings" link.
- [ ] Failing tests:
    - the page renders the saved values;
    - the actions call `requireAgent` and pass the session's `agencyId`;
    - the route returns 404 when there is no logo, and the bytes plus the security headers when there is one;
    - the route uses only the session's agency;
    - the menu links to `/settings`.
- [ ] Implement → green; then typecheck, lint, build and e2e → commit.

### Task 4: Ship
- [ ] Screenshot `/settings` on desktop and phone.
- [ ] Reviews: `requesting-code-review`, `differential-review` and `/security-review` (PII and file upload).
- [ ] Open a PR. Auto-merge merges it when CI is green; check that it merged and that staging updated.
