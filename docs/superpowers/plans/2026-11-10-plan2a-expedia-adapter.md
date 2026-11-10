# Plan 2a: Expedia Rapid adapter (no live connection yet)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A tested server-side adapter for Expedia Rapid v3. It covers signature auth, the HTTP client, the supplier log, money parsing, availability and price check, and returns one normalized model. Everything is built from the official OpenAPI spec and tested against responses shaped like the spec, because there are no API keys yet. When the test keys arrive, only the environment variables are added, plus one smoke test against `test.ean.com`.

**Architecture:**
- **Layering:** UI → server actions → services → `SupplierAdapter` → `ExpediaAdapter` → `expediaClient` (HTTP). Only the adapter knows Expedia's field names; the rest of the app sees the normalized types in `src/server/supplier/types.ts`.
- **Supplier log:** every request and response is written to `SupplierCallLog`, with personal data masked.
- **Out of scope:** booking calls (`/itineraries`) belong to plan 3; content sync and the search UI belong to plan 2b.

**Tech Stack:** Node `fetch` with `AbortSignal.timeout`, `node:crypto` (SHA-512), Zod, Prisma. No new packages.

**Sources:**
- `docs/research/expedia-api/rapid-3-specs.yaml`: the official OpenAPI 3.0.1 spec, "EPS Rapid V3", downloaded 2026-11-10 from Expedia's API Explorer.
- `docs/research/expedia-checklist-2026-alignment.md` and `docs/decisions/2026-11-10-expedia-checklist-alignment.md`: the approved changes to spec section 6.
- Expedia docs, rendered 2026-11-10: signature authentication, rate limiting, error responses, test requests.

## Global Constraints
- **Auth:** the header is `Authorization: EAN APIKey=<key>,Signature=<sha512 hex of key+secret+unixSeconds>,timestamp=<unixSeconds>`. The timestamp in the header is the same one used in the hash.
- **Required headers on every call:**
    - `Accept: application/json`
    - `Accept-Encoding: gzip`
    - `User-Agent`: the agent's browser User-Agent; our own app name when there is none
    - `Customer-Ip`: the agent's IP, from the existing client-IP helper
    - `Customer-Session-Id`: one value per agent session
- **Environment variables, all documented in `.env.example`:**
    - `EXPEDIA_API_KEY`, `EXPEDIA_SHARED_SECRET`, `EXPEDIA_BASE_URL`
    - The base URL must be `https://test.ean.com/v3` unless `APP_ENV=production`. The client refuses to start otherwise ("no live credentials, ever").
    - The secret never appears in logs, errors or the supplier log.
- **Test safety:** outside production, every booking call sends the `Test` header (in plan 3; the client enforces it now), because without it a booking on test.ean.com is real.
- **`country_code`** is the agency's country, i.e. the point of sale (decision 2026-11-10). There is no nationality parameter in Rapid: the spec was checked.
- **Money:**
    - Rapid amounts are decimal strings, like `"74.97"`. They are parsed with string arithmetic into integer minor units, using the currency's ISO 4217 exponent from `Intl.NumberFormat`. Never `parseFloat`.
    - More decimals than the exponent allows → reject.
- **Timeouts:** shopping 15 s, price check 15 s.
- **429:** no retry inside the request. The adapter raises `SupplierRateLimited`, and the UI shows "Search unavailable" (screen 24).
- **5xx and network errors:** one retry for idempotent GETs only.
- **Supplier responses:**
    - Zod validates every field we use.
    - Unknown fields are dropped and their names recorded in the supplier log. Each call is not rejected because of them.
    - **This needs owner approval, because CLAUDE.md says "reject unknown fields".** Rejecting would break search every time Expedia adds a field.
- **Supplier log:**
    - Fields: method, path plus query, status, duration, `affiliate_reference_id`, and the request and response bodies.
    - Masking: names, email, phone and address are masked. The bodies are capped at 256 KB.
    - It is kept 90 days; the cleanup job comes in plan 4.

## Review Focus
1. **The shared secret leaks** into a log, an error message or the supplier log. The test asserts it is absent everywhere (Task 2).
2. **A live base URL is used outside production.** The client throws at start-up (Task 2).
3. **Money:** `"74.975"` USD, `"1000"` JPY, `"12.345"` KWD and `"-5.00"` parse exactly or are rejected, never rounded (Task 1).
4. **A malformed or partial availability response** returns a typed error, never a crash and never a half-priced offer (Task 4).
5. **The price total does not match its parts:** the offer keeps Expedia's `inclusive` total as the price. The breakdown is shown as given and never recomputed into the total (BP5: "no rounding"; Task 4).

---

### Task 1: Money parsing
- `src/lib/supplier-money.ts`:
    - `currencyExponent(code): number`
    - `parseAmount(value: string, currency: string): { minor: number; currency: string }`, which throws `InvalidAmount`
    - `formatMinor(minor, currency): string`
- Tests:
    - USD `"74.97"` → 7497
    - USD `"74.9"` → 7490
    - JPY `"1000"` → 1000
    - KWD `"12.345"` → 12345
    - USD `"74.975"` → throws
    - `"abc"`, `""` and `"1e3"` → throw
    - negative values: allowed only for refund deltas; reject by default

### Task 2: Signature, client and supplier log
- `src/server/supplier/expedia/signature.ts`: `authHeader(key, secret, nowSeconds)`. Tested against a vector computed independently in the test.
- `src/server/supplier/expedia/client.ts`:
    - `expediaRequest({ method, path, query, body, context, timeoutMs, idempotent })`
    - `context = { customerIp, userAgent, sessionId, test? }`
    - It builds the headers, applies the timeout, retries once on 5xx for an idempotent GET, maps 401/403/429/5xx to typed errors, and writes `SupplierCallLog` (masked).
- Migration `supplier_call_log`: table plus an index on `createdAt`.
- Tests:
    - the headers are exact
    - the secret never appears in the log or error text
    - a live base URL outside production → throws
    - the timeout → `SupplierTimeout`
    - 429 → `SupplierRateLimited` with no retry
    - a 503 GET → retried once
    - a POST → never retried
    - PII (email, phone, given_name, family_name, address) is masked in the stored bodies

### Task 3: Normalized types and adapter interface
- `src/server/supplier/types.ts`:
    - `SupplierAdapter { searchAvailability(q): Promise<PropertyOffers[]>; priceCheck(token): Promise<PriceCheckResult> }`
    - `Offer` holds: property id, room id/name, rate id, bed groups (id, description, price-check token), refundable, cancel penalties, nonrefundable date ranges, and the pricing breakdown (see below).
- **`PriceBreakdown`** is the one model behind BP4/BP5/CP1/ER6:
    - `total` = `totals.inclusive`, from Expedia, never recomputed
    - `baseRate` = sum of the nightly `base_rate`
    - `taxesAndFees` = `tax_and_service_fee` + `property_fee`, shown as one line
    - `extraNightlyFees`
    - `dueAtProperty[]`: each item from `fees`, with both `request_currency` and `billable_currency`
    - `payNow`
    - The legal text goes in a constant, `TAXES_AND_FEES_LEGAL_COPY`.

### Task 4: Availability and price check
- `ExpediaAdapter.searchAvailability({ propertyIds (1–250), checkin, checkout, adults, childAges[], countryCode, currency: "USD", language: "en-US", salesChannel: "agent_tool", salesEnvironment: "hotel_only" })`.
- **Rates to exclude:**
    - any rate with `sale_scenario.package === true` (AP4 not applicable);
    - any rate with `merchant_of_record` other than `expedia` (property collect; GR5 / BP8 not applicable).
- `priceCheck(token)` → `{ status: "available" | "price_changed" | "sold_out", offer? }`, from `RoomPriceCheck`.
- Tests use fixtures built from the spec's schemas:
    - two properties, a refundable and a non-refundable rate, resort and mandatory fees in EUR, and a child-age occupancy
    - partially unavailable properties
    - a price change on price check
    - a malformed fixture (a missing `totals`) → `SupplierResponseInvalid`

### Task 5: Ship
- typecheck, lint, tests, build.
- `requesting-code-review`, `differential-review` and `/security-review` (supplier API and secrets).
- PR, then auto-merge.
