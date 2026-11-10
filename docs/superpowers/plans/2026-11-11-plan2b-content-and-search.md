# Plan 2b: Hotel content sync, background jobs and the search service — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The server side of search. Apolles keeps a local copy of Expedia's destinations and hotels, refreshed every day by a background worker. A search turns a destination plus dates into priced results that can be filtered, sorted and paged without calling Expedia again. Screens 07, 08 and 09 come in plan 2c.

**Architecture:**
- **Layering:** UI (plan 2c) → server actions → `src/server/search/*` → local tables plus the `SupplierAdapter` from plan 2a.
- **Background work:** a Postgres job table, claimed with `FOR UPDATE SKIP LOCKED`, and run by a separate `worker` process from the same codebase (spec section 7).
- **Content sources:**
    - Destinations come from Rapid `/regions`, with the property ids of each.
    - The hotel list comes from the daily catalog file.
    - The full content of a hotel (images, policies, check-in) is fetched on demand and cached for 24 hours.

**Tech Stack:** Prisma + Postgres, Zod, Node `fetch`, `node:zlib` and `node:readline`. **No new packages.**

**Spec:**
- `docs/specs/approved/2026-11-08-apolles-design.md`: section 3 rows 4–6, section 6 (TR2, TR7, BP5, GR1), section 7 ("background jobs", "local hotel database").
- `docs/superpowers/plans/2026-11-10-plan2a-expedia-adapter.md`: this plan builds on its adapter.
- `docs/decisions/2026-11-10-supplier-unknown-fields.md`.
- Official source: `docs/research/expedia-api/rapid-3-specs.yaml`.

**Depends on:** [moshezbusy/apolles#6](https://github.com/moshezbusy/apolles/pull/6) (plan 2a) being merged. Start Task 1 only from a `main` that contains it.

## Decisions made for this plan [Claude's decisions; the owner can overrule]

1. **Which destinations (the spec's open question "database size", section 7):**
    - Only hotels and destinations in the countries listed in `CONTENT_COUNTRIES` (`src/server/content/scope.ts`) are stored.
    - Starter list: `GR, CY, IT, FR, ES, PT, GB, DE, NL, AT, CZ, HU, RO, BG, GE, AE, TH, US`.
    - **Why:** staging runs on a shared VPS with a 512 MB database container (`deploy/staging/docker-compose.yml`). The worldwide catalog would not fit comfortably.
    - **How to change:** the owner names countries in chat, and the change is a one-line PR.
2. **Only hotels that Expedia collects for** (`business_model.expedia_collect = true`) are searchable. Affiliate Collect works only on these (`docs/research/expedia-launch-requirements.md`, "Payment models"), and plan 2a already drops property-collect rates.
3. **One availability call per search** covers up to 250 hotels, best `rank` first. "Load more" makes the next call. This keeps the look-to-book ratio low (Expedia question 6 is still open).
4. **Search results are a stored snapshot**, valid for 30 minutes. Filtering, sorting and paging read the snapshot, not Expedia. The price is checked again before booking anyway (plan 3).
5. **Content cache:** content is fresh for 24 hours. If Expedia fails, cached content up to 7 days old is served. Older than that is an error.

## Global Constraints

- **Rapid limits** (from the spec):
    - `property_id`: 1–250 per call;
    - check-in up to **365 days** ahead;
    - stay up to **28 nights**;
    - one room, at least 1 adult.
- **Search input:**
    - adults 1–8;
    - children 0–6, each age 0–17;
    - check-in ≥ today (UTC) and ≤ today + 365;
    - checkout > check-in, ≤ 28 nights.
- **`country_code`** is the agency's country, read from the DB, never from the request (TR2, decision 2026-11-10).
- **Every snapshot query is scoped by `agencyId` from the session.** Another agency's snapshot id returns `null` (no IDOR).
- **Money:**
    - Prices stay `Money` (integer minor units plus currency) from plan 2a.
    - Sorting uses `price.total.minor`. The total is never recomputed (BP5).
- **Supplier errors in search:** `SupplierRateLimited`, `SupplierTimeout` and `SupplierUnavailable` become `SearchUnavailable` (screen 24, "Search unavailable"). There is no retry inside the request (TR7).
- **Agency rate limit:** at most **30 searches per minute** per agency, via the existing `hitRateLimit`. Over the limit → `SearchRateLimited`.
- **Job failures:**
    - Backoff of 1 min, 5 min, then 30 min; after 3 attempts the job is `FAILED`.
    - A `RUNNING` job with `lockedAt` older than 30 minutes is reclaimed.
    - `lastError` stores the error class and at most 500 characters of the message, never a response body.
- **Downloading the catalog file:**
    - The link must be `https:`.
    - The host must not be an IP literal or `localhost`.
    - The Expedia `Authorization` header is never sent to the download host.
- **Supplier text** (descriptions, policies) is stored as given. Rendering it safely is plan 2c's job and is flagged there.
- **Index every query pattern; paginate every list** (CLAUDE.md section 3).

## Review Focus

1. **A destination with no searchable hotels** (none are Expedia-collect, or all are inactive) returns an empty result and makes **no** Expedia call (Task 6).
2. **Agency B opens agency A's search id** (results, hotel offers or "load more"), and gets `null`, not data (Task 6).
3. **The catalog download breaks halfway:** no hotel is marked inactive, and the run is recorded as `FAILED` (Task 3).
4. **Two worker processes run at once:** each job runs exactly once (Task 1).
5. **Expedia returns a hotel that was not in the requested batch, or the same hotel twice:** the stranger is ignored, and the duplicate is stored once (Task 6).

---

### Task 1: Job queue and worker process

**Files:**
- Create:
    - `src/server/jobs/queue.ts`, `src/server/jobs/schedule.ts`, `src/server/jobs/handlers.ts`
    - `src/worker.ts`
    - migration `jobs`
- Modify:
    - `prisma/schema.prisma`
    - `package.json` (script `worker`)
    - `deploy/staging/docker-compose.yml` and `deploy/staging/README.md` (a `worker` service on the same image, command `pnpm worker`, `mem_limit: 256m`)
- Test: `src/server/jobs/queue.test.ts`, `src/server/jobs/schedule.test.ts`

**Interfaces:**
- Produces:
    - Model `Job { id, kind String, payload Json, status JobStatus (QUEUED|RUNNING|DONE|FAILED), attempts Int @default(0), runAt DateTime, lockedAt DateTime?, lastError String?, dedupeKey String? @unique, createdAt, finishedAt DateTime? }`, with `@@index([status, runAt])`.
    - `enqueue(kind: JobKind, payload: object, opts?: { runAt?: Date; dedupeKey?: string }): Promise<{ id: string; created: boolean }>`
    - `claimNext(now: Date): Promise<Job | null>`: a single statement, `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`.
    - `completeJob(id): Promise<void>` and `failJob(id, error: unknown, now: Date): Promise<void>`
    - `type JobKind = "content.regions" | "content.catalog" | "content.inactive" | "search.cleanup"`
    - `ensureDailyJobs(now: Date): Promise<void>`: one job of each kind per UTC day at 02:00, with `dedupeKey = "<kind>:<YYYY-MM-DD>"`.
    - `HANDLERS: Record<JobKind, (payload: unknown) => Promise<void>>`: Tasks 3, 4, 5 and 6 register here.
    - `pnpm worker`: every 5 s, call `ensureDailyJobs`, then claim and run jobs until none are left. On SIGTERM, finish the current job and exit 0.

- [ ] **Step 1: Write the failing tests:**
    - `enqueue twice with the same dedupeKey → one row, second call created=false`
    - `two concurrent claimNext with one queued job → exactly one gets it` (`Promise.all`)
    - `failJob → attempts 1, status QUEUED, runAt = now + 1 min; third failure → FAILED`
    - `RUNNING with lockedAt 31 min ago → claimNext returns it again`
    - `failJob with a 2,000-char message → lastError ≤ 500 chars and starts with the error class name`
    - `ensureDailyJobs called twice on one day → 4 jobs, not 8`
    - `job with runAt in the future → claimNext returns null`
- [ ] **Step 2:** Run `pnpm test src/server/jobs`. Expected: FAIL.
- [ ] **Step 3:** Implement the model, migration, queue, schedule and `src/worker.ts` (run it like `prisma/unlock.ts`, with `--import ./prisma/ts-loader.mjs`). Add the compose `worker` service.
- [ ] **Step 4:** Run `pnpm test src/server/jobs`, 5 runs in a row. Expected: PASS. Then run `pnpm typecheck && pnpm lint`.
- [ ] **Step 5:** Commit: `feat: Postgres job queue and worker process`.

### Task 2: Content calls in the Expedia adapter

**Files:**
- Modify:
    - `src/server/supplier/expedia/client.ts`: also return `nextToken: string | null`, taken from the `token` query parameter of the `Link` header with `rel="next"`.
    - `src/server/supplier/types.ts`
    - `src/server/supplier/expedia/adapter.ts`, or a new `content.ts` beside it if `adapter.ts` passes about 500 lines.
- Create: fixtures from the spec examples, in `src/server/supplier/expedia/fixtures/`: `regions.*.json`, `content.*.json`, `catalog-link.json`, `inactive.json`.
- Test: `src/server/supplier/expedia/content.test.ts`

**Interfaces:**
- Produces, in `types.ts`, a new interface `ContentSource`, implemented by `ExpediaAdapter`:
    - `listRegions(q: { countryCode: string; token?: string }): Promise<{ regions: RegionInfo[]; nextToken: string | null }>`.
        - The request uses `include=details` and `include=property_ids`, `type` = `city` and `multi_city_vicinity`, `language=en-US` and `supply_source=expedia`.
    - `catalogLink(): Promise<{ href: string }>`. Its timeout is 15 s.
    - `propertyContent(ids: string[] /* 1–250 */): Promise<PropertyContent[]>`. The request uses `language=en-US` and `supply_source=expedia`, and its timeout is 30 s.
    - `inactiveSince(q: { since: string; token?: string }): Promise<{ propertyIds: string[]; nextToken: string | null }>`
- The types:
    - `RegionInfo { id; name; nameFull; type: "city" | "multi_city_vicinity"; countryCode; propertyIds: string[] }`
    - `PropertyContent { propertyId; name; address { line1; city; stateProvince: string | null; postalCode: string | null; countryCode }; starRating: string | null; coordinates: { lat: string; lng: string } | null; heroImage: Image | null; images: Image[]; amenities: string[]; checkin { beginTime; endTime; instructions: string | null; specialInstructions: string | null; minAge: number | null }; checkout { time: string | null }; fees { mandatory: string | null; optional: string | null }; knowBeforeYouGo: string | null; description: string | null; onsiteCurrency: string | null; rooms: RoomContent[] }`
    - `Image { url /* https only */; caption: string | null }`
    - `RoomContent { id; name; images: Image[]; amenities: string[]; maxOccupancy: number | null }`
- Rules:
    - Validation follows plan 2a: Zod on the fields used, unknown fields dropped and recorded with `recordUnknownFields`.
    - One bad property or region is skipped and recorded, not fatal.
    - An image URL that is not `https:` is dropped.
    - Coordinates and star ratings stay decimal strings. No float.

- [ ] **Step 1: Write the failing tests:**
    - `listRegions sends include=details and include=property_ids and both types`
    - `Link header with rel="next" → nextToken is its token value; no Link → null`
    - `propertyContent with 251 ids → throws before any call`
    - `content fixture → name, starRating "4.5", checkin.instructions and fees.mandatory as given`
    - `an http:// image → dropped; the property is kept`
    - `a property missing name → skipped, the others returned, its path recorded`
    - `catalogLink fixture → href`
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `pnpm test src/server/supplier`. Expected: PASS, including every plan 2a test.
- [ ] **Step 5:** Commit: `feat: Expedia content calls (regions, catalog link, content, inactive)`.

### Task 3: Daily hotel catalog sync

**Files:**
- Create:
    - `src/server/content/scope.ts`, holding `CONTENT_COUNTRIES` (decision 1)
    - `src/server/content/catalog-sync.ts`
    - `src/server/content/download.ts`
    - migration `content_catalog`
- Modify: `prisma/schema.prisma`, `src/server/jobs/handlers.ts`
- Test: `src/server/content/catalog-sync.test.ts`, with a small `.jsonl.gz` fixture built in the test.

**Interfaces:**
- Consumes: `catalogLink()` (Task 2), `HANDLERS` (Task 1).
- Produces:
    - Model `Property { id String @id /* Expedia property id */; name; city; countryCode; stateProvince String?; starRating Decimal? @db.Decimal(2,1); latitude Decimal? @db.Decimal(9,6); longitude Decimal? @db.Decimal(9,6); rank Int?; expediaCollect Boolean; active Boolean @default(true); catalogSeenRunId String; updatedAt }`, with `@@index([active, expediaCollect, rank])`.
    - Model `ContentSyncRun { id; kind String; status (RUNNING|DONE|FAILED); startedAt; finishedAt?; counts Json }`, with `@@index([kind, status, startedAt])`.
    - `openCatalogStream(href: string): Promise<AsyncIterable<string>>` in `download.ts`. It checks the URL (Global Constraints), gunzips, and yields one line at a time.
    - `syncCatalog(deps?: { source?: ContentSource; open?: typeof openCatalogStream }): Promise<{ upserted: number; invalid: number; skippedCountry: number; deactivated: number }>`
- Rules:
    - Lines outside `CONTENT_COUNTRIES` are skipped.
    - Rows are upserted in batches of 1,000.
    - **Only after the whole file is read** are rows of those countries with a `catalogSeenRunId` other than this run's set `active = false`.
    - Any error → the run is `FAILED` and nothing is deactivated.
    - The job kind is `content.catalog`.

- [ ] **Step 1: Write the failing tests:**
    - `3 lines (FR, FR, JP) plus 1 malformed → upserted 2, skippedCountry 1, invalid 1`
    - `run 2 without property X → X.active false; run 1 rows still seen stay true`
    - `stream throws after line 2 → run FAILED, deactivated 0, no row changed to inactive`
    - `business_model.expedia_collect false → expediaCollect false`
    - `openCatalogStream("http://…"), ("https://127.0.0.1/…"), ("https://localhost/…") → throws`
    - `the download request carries no Authorization header`
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: daily hotel catalog sync`.

### Task 4: Daily destinations sync

**Files:**
- Create: `src/server/content/regions-sync.ts`, migration `content_destinations`
- Modify: `prisma/schema.prisma`, `src/server/jobs/handlers.ts`
- Test: `src/server/content/regions-sync.test.ts`

**Interfaces:**
- Consumes: `listRegions` (Task 2), `CONTENT_COUNTRIES` (Task 3).
- Produces:
    - Model `Destination { id String @id; name; nameFull; type; countryCode; propertyCount Int; active Boolean; seenRunId String; updatedAt }`
    - Model `DestinationProperty { destinationId; propertyId; @@id([destinationId, propertyId]); @@index([propertyId]) }`. There is no foreign key to `Property`, because the two syncs run independently.
    - The migration also adds a raw SQL index: `CREATE INDEX destination_name_prefix ON "Destination" (lower(name) text_pattern_ops) WHERE active`.
    - `syncRegions(deps?: { source?: ContentSource }): Promise<{ destinations: number; deactivated: number }>`. The job kind is `content.regions`.
- Rules:
    - Pages are followed with `nextToken` for each country.
    - Each region's property list is replaced in one transaction.
    - Deactivation happens only after every country has finished.
    - `SupplierRateLimited` → the run is `FAILED` and nothing is deactivated, and the job queue retries it.

- [ ] **Step 1: Write the failing tests:**
    - `two pages for FR → both pages stored`
    - `region's property list shrinks from [1,2,3] to [2] → join has only 2`
    - `region missing in run 2 → active false`
    - `rate limited on country 2 → FAILED, nothing deactivated`
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: daily destinations sync`.

### Task 5: Content cache and inactive hotels

**Files:**
- Create: `src/server/content/content-cache.ts`, `src/server/content/inactive-sync.ts`, migration `content_cache`
- Modify: `prisma/schema.prisma`, `src/server/jobs/handlers.ts`
- Test: `src/server/content/content-cache.test.ts`, `src/server/content/inactive-sync.test.ts`

**Interfaces:**
- Consumes: `propertyContent` and `inactiveSince` (Task 2).
- Produces:
    - Model `PropertyContentCache { propertyId String @id; data Json /* PropertyContent */; fetchedAt DateTime }`, with `@@index([fetchedAt])`.
    - `getContent(ids: string[], now?: Date): Promise<Map<string, PropertyContent>>`
        - Rows fresher than 24 h come from the cache.
        - Missing or stale ids are fetched in batches of 250.
        - On a supplier error, rows up to 7 days old are used. Ids with nothing usable are left out of the map.
    - `syncInactive(now?: Date): Promise<{ deactivated: number }>`
        - `since` = the start of the last `DONE` `content.inactive` run, or now − 24 h.
        - Each listed property gets `active = false`, and its cache row is deleted.
        - The job kind is `content.inactive`.

- [ ] **Step 1: Write the failing tests:**
    - `fresh cache row → no supplier call`
    - `stale row + supplier OK → refetched and fetchedAt updated`
    - `stale row (3 days) + supplier timeout → stale data returned`
    - `row 8 days old + supplier timeout → id absent from map`
    - `600 missing ids → 3 calls (250, 250, 100)`
    - `inactive ids → Property.active false and cache rows deleted`
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: hotel content cache and inactive sync`.

### Task 6: Search service

**Files:**
- Create:
    - `src/server/search/destinations.ts`
    - `src/server/search/input.ts`
    - `src/server/search/search.ts`
    - `src/server/search/errors.ts`
    - migration `search_snapshots`
- Modify:
    - `prisma/schema.prisma`
    - `src/server/scope.ts`: add the snapshot helpers to `forAgency`
    - `src/server/rate-limit.ts`: add a `search` entry to `RATE_LIMITS`
    - `src/server/jobs/handlers.ts`
- Test: `src/server/search/*.test.ts`

**Interfaces:**
- Consumes:
    - `SupplierAdapter.searchAvailability` (plan 2a)
    - `getContent` (Task 5)
    - `forAgency` and `hitRateLimit` (existing)
    - the `Property`, `Destination` and `DestinationProperty` tables
- Produces:
    - `suggestDestinations(q: string, limit = 10): Promise<{ id: string; label: string; type: string }[]>`
        - Trims `q`. A query of under 2 or over 60 characters returns `[]`.
        - Case-insensitive prefix match on `name`; active destinations only.
        - Ordered by `propertyCount` descending.
    - `searchInput`, a Zod schema in `input.ts`: `{ destinationId: string; checkin: string; checkout: string; adults: number; childAges: number[] }`, with the Global Constraints limits. `.strict()`.
    - Model `SearchSnapshot { id; agencyId; userId; query Json; candidateIds String[]; nextIndex Int; createdAt; expiresAt; @@index([agencyId, createdAt]); @@index([expiresAt]) }`
    - Model `SearchHotel { snapshotId; propertyId; name; starRating Decimal?; minTotalMinor Int; currency; refundableAvailable Boolean; offers Json /* Offer[] */; @@id([snapshotId, propertyId]); @@index([snapshotId, minTotalMinor]) }`
    - `startSearch(ctx: { agencyId; userId; supplierContext: SupplierContext }, input: unknown): Promise<{ snapshotId: string }>`
        - Reads the agency's country from the DB for `countryCode`.
        - Candidates: the destination's properties that are active and `expediaCollect`, by `rank` ascending (nulls last). Fetches the first 250.
        - Throws `SearchInputInvalid`, `SearchRateLimited` or `SearchUnavailable`.
    - `loadMore(ctx, snapshotId): Promise<{ added: number; hasMore: boolean } | null>`: the next 250 candidates.
    - `listResults(agencyId, snapshotId, opts: { sort: "recommended" | "price_asc" | "price_desc" | "stars_desc"; minPriceMinor?: number; maxPriceMinor?: number; stars?: number[]; name?: string; cursor?: string; take?: number /* default 20, max 50 */ }): Promise<{ hotels: HotelCard[]; nextCursor: string | null; hasMoreFromSupplier: boolean; expired: boolean } | null>`
        - `HotelCard = { propertyId; name; starRating: string | null; minTotal: Money; refundableAvailable: boolean; heroImage: Image | null; city: string }`
    - `getHotelOffers(agencyId, snapshotId, propertyId): Promise<{ offers: Offer[]; content: PropertyContent | null } | null>`
    - `cleanupSnapshots(now: Date)`: deletes snapshots whose `expiresAt` is more than 1 h ago. The job kind is `search.cleanup`.
    - Errors: `SearchInputInvalid`, `SearchRateLimited`, `SearchUnavailable`, `SearchExpired`.
- Rules:
    - A snapshot expires 30 minutes after `createdAt`.
    - `listResults` on an expired snapshot returns `expired: true` and no hotels. The UI offers a new search.
    - `"recommended"` = the candidate (rank) order.
    - The `stars` filter matches the whole-star part, so a 4.5 hotel counts as 4. A hotel with no rating matches no `stars` filter.
    - A hotel from Expedia that is not in the requested batch is ignored. A duplicate is stored once (`@@id`).

- [ ] **Step 1: Write the failing tests:**
    - `destination with 0 searchable hotels → empty snapshot and the fake adapter was never called`
    - `countryCode sent = agency's country even if input carries countryCode` (and the strict schema rejects the extra field)
    - `checkout 29 nights after checkin, checkin in the past, checkin 366 days ahead, adults 0, child age 18 → SearchInputInvalid`
    - `600 candidates → first call has 250 ids in rank order; loadMore → next 250; third loadMore → 100 and hasMore false`
    - `agency B listResults / getHotelOffers / loadMore on agency A's snapshot → null`
    - `adapter returns a property outside the batch and one property twice → stranger ignored, duplicate stored once`
    - `sort price_asc orders by total.minor; stars filter [4,5]; name filter is case-insensitive contains`
    - `SupplierRateLimited from adapter → SearchUnavailable; 31st search in a minute → SearchRateLimited`
    - `snapshot 31 minutes old → listResults expired true`
    - `suggestDestinations("pa") → Paris before a smaller "Palma"; "p" → []`
- [ ] **Step 2:** Run `pnpm test src/server/search`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS. Then run the full `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- [ ] **Step 5:** Commit: `feat: search service with stored snapshots`.

### Task 7: Ship

- [ ] **Step 1:** Run `requesting-code-review`, `differential-review` and `/security-review` (supplier API, downloads, agency isolation). Fix every finding, then re-run the full checks.
- [ ] **Step 2:** Open the PR. Auto-merge follows a green CI.
- [ ] **Step 3 (when the test keys arrive; not part of this PR):** Run one `content.regions` and one `content.catalog` job against `test.ean.com`. Record the row counts and the database size in the PR thread. Then confirm or shrink `CONTENT_COUNTRIES`.

## Self-review notes

- **Spec coverage:**
    - Section 3, row 4 (search input) and row 5 (filters by price, stars and name; sort; "load more"; loading state in 2c): Task 6.
    - Section 3, row 6 (hotel page data): Task 5 (content) plus Task 6 (`getHotelOffers`).
    - Section 7, "local hotel database, refreshed daily": Tasks 3–5. "Background jobs": Task 1.
    - TR2: Task 6. TR7: Task 6 and plan 2a. BP5: no recompute; sorting uses the total.
- **Not here:**
    - screens 07, 08 and 09, and safe rendering of supplier HTML: plan 2c;
    - booking, `PENDING_CONFIRMATION` reconciliation and email jobs: plans 3 and 4, which reuse Task 1's queue;
    - the 90-day supplier-log cleanup: plan 4, as a new `JobKind`.
- **Type consistency:**
    - `ContentSource`, `PropertyContent`, `RegionInfo` and `Image` are defined in Task 2 and used in Tasks 3–6.
    - `JobKind` values match the four handlers.
