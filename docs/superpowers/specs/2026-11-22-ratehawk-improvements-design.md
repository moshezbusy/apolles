# RateHawk-inspired improvements — design and plan (DRAFT, waiting for Moshe's approval)

Status: **not approved. No code written.** Owner request 2026-11-22. Mockups: branch
`claude/brave-goldberg-v7adee` @ a53490f (pages 07, 08, 09, 10, 11, 12, 20).
Out of scope: item 1 (already on main), item 9 (other session), loyalty, ads, flights, cars,
transfers, offline requests. Rule: where Expedia Rapid rules and the owner's wording conflict,
Rapid wins (marked **RAPID** below).

Audit of main was done by reading code only (nothing run). "Unknown" = not checked.

---

## Item 2 — Taxes and fees

**Exists:** `adapter.ts` parses `totals.inclusive` (total), `property_fees`, `fees.mandatory_fee /
resort_fee / mandatory_tax` (request + billable currency), nightly `tax_and_service_fee` etc.
`PriceDetails` (`_components/hotel-info.tsx:86-113`) already shows total, a "Taxes and fees" line
and a box "Paid at the property, not included in the total" with each fee in local currency
"(about USD …)". Used on hotel page, book/new, book/[id], bookings/[id]. Voucher has a "To pay at
the property" section.

**Missing:** owner's wording/labels; `property_inclusive` and `exclusive` unused; no
pay-at-property total; booking summary layout per mockup 12.

**RAPID (api-docs, BP4 + price-display image):** each property fee must be shown **as its own
line** ("display each value separately"), in **local currency and request currency**, with a
note that the conversion is approximate. So "Pay at property" is a block with one line per fee
(resort fee / mandatory fee / mandatory tax) plus a total — not a single summed line only. The
included-taxes line in Expedia's example is labelled "Tax recovery charges and service fees".

**Change:** in `PriceDetails` two clearly titled sections: "Included in price" (room price +
"Taxes and fees (tax recovery charges and service fees)") and "Pay at property" (one line per fee,
local amount first, "(about USD x)", then total, then the approximate-conversion note). Same
component on hotel page, review page and booking summary. Pure display change: no money logic,
no DB change. Files: `hotel-info.tsx`, its test, pages that render it (labels only).

## Item 3 — Search form

**Exists:** dates; adults per room; age for every child (0-17, required); up to 8 rooms in the
form; destination autocomplete for cities/areas.

**Missing:** hotels in autocomplete (today regions only), separate "Destinations" / "Hotels"
groups; nationality field.

**Notes:** several rooms are switched off with real Expedia on purpose (plan 10: needs Expedia
test keys to confirm how multi-room prices are keyed). This plan keeps that switch.
**RAPID:** the code says Rapid shopping takes only point of sale (agency country), not guest
nationality (`src/server/search/input.ts:6`). A nationality field would be stored and shown but
would not change prices → **question for Moshe** (below).

**Change:** `suggestDestinations` also returns hotels by name from the cached catalog
(`Property` table, agency-independent content), max 5 regions + 5 hotels; picker shows two
labelled groups; choosing a hotel searches that one property (new `type=hotel`). Files:
`server/search/destinations.ts`, `search/destinations/route.ts`, `destination-picker.tsx`,
`server/search/input.ts`, `search.ts` (single-property search), tests. Needs a DB index on
property name for prefix search (migration).

## Item 4 — Free cancellation

**Exists:** every rate row on the hotel page shows "Free cancellation until …" or
"Non-refundable" + full policy; review page shows it; bookings list shows "Free cancel until".

**Missing:** "$0 until <date>" wording as its own column; short deadline badge on the booking
summary (today only the long policy list).

**Change:** `rate-text.ts` gets one helper for the short text ("$0 until Jan 9, 18:00 hotel time"
/ "Non-refundable" / "Check policy" when unknown); used as a column in the rooms table and as a
line at the top of the booking summary (`bookings/[id]/page.tsx`), from the stored
`freeCancelEndsAt`. Display only.

## Item 5 — Search in the URL

**Exists:** filters/sort/paging already in the URL. Search itself is a DB snapshot
(`/search/<id>`), valid 30 min, deleted after 60 min → old links show "expired" or 404.
Snapshot is scoped by agency (good).

**Missing:** destination, dates, rooms, child ages, nationality in the URL; reopen after expiry.

**Change:** new URL form `/search/results?dest=<regionId|h:propertyId>&in=YYYY-MM-DD&out=…&rooms=2-5-9,2&nat=IL`
+ existing filter/sort params (my call: ids and ISO code instead of the mockup's display text,
so links are exact). The page validates the params with the same Zod schema, then reuses the
agency's fresh snapshot for the same query or starts a new search. Old `/search/<id>` links
keep working. Rate limiting as today. Files: `search/actions.ts` (redirect to the URL form),
new `search/results/page.tsx` (or reuse `[id]` page logic), `server/search/search.ts`
(find-or-create snapshot by query hash + agencyId; index), `list-options.ts`, hotel page links,
recent searches link, tests (round-trip URL ⇄ query).

## Item 6 — Results filters and sort

**Exists:** hotel name, room name, price min/max, stars, free cancellation; sorts: recommended,
price up/down, stars. One "Clear filters" link.

**Missing:** board (meal), guest rating, amenities, property type filters; rating sort; chips with
X; carry filters into hotel rooms table with "20 of 22 options match your filters".

**Popularity (OPEN, checked):** Expedia gives no "popularity" field in our docs. What we have is
the catalog `rank` — already used as "Recommended". Proposal: keep the name "Recommended", do
not invent "Popularity". → **tell Moshe**.

**Data gaps:** guest rating (`ratings.guest`) and property type (`category`) come from Expedia but
are thrown away today; amenities are only in a JSON blob; meal plan has no structured field
(only names like "Breakfast included"). Need: parse + store `guestRating`, `propertyType`,
amenity ids, and a normalized `board` per rate (room only / breakfast / half / full / all
inclusive) from Rapid's rate amenities/`all_inclusive`. DB migration with indexes.

**Change:** split into 6a (data: parse/store/migration), 6b (filters + sort + chips + clear all),
6c (carry filters into hotel rooms table + "X of Y match" + clear button).

## Item 7 — Agent home: "Free cancellation ends in 24 hours"

**Exists:** `Booking.freeCancelEndsAt` with index `[status, freeCancelEndsAt]`; hourly job emails
reminders 72 h before.

**Missing:** an agent home page (agents land on `/search`); the panel. **There is no auto-cancel
logic and no "Vouchered" status on main** (statuses: CONFIRMED, CANCELLED, …). The request said
"tied to the existing auto-cancel logic" — that does not exist → **question for Moshe**.

**Change (proposal):** panel at the top of `/search` (agents' landing page) listing the agency's
CONFIRMED bookings with `freeCancelEndsAt` in the next 24 h (max 10, link to all), scoped by
agencyId, using the existing index. No auto-cancel added.

## Item 8 — Guest details page

**Exists:** first + last name for every guest in every room (all required today), email, phone,
special requests: Early check-in, Late check-out, High floor, Honeymoon + free text (300 chars),
sent to Expedia as `special_request` (room 1 only). Agency markup ("selling price") exists for
reports only, on the review page.

**Missing:** Net/Gross choice; "On request" wording for early check-in / late check-out;
special request only sent for room 1.

**Change:** Net/Gross toggle on the guest page that only changes which price is displayed
(gross = net + agency default markup). Never changes what is charged; server recomputes, client
values ignored. Label early/late as "(On request — not guaranteed)". Send each room's request on
its own room (Rapid supports `special_request` per room). Other guests' names stay required
(my call: matches today and avoids incomplete vouchers) — Moshe may say "optional".

---

## PR order (small PRs)

1. Item 4 + item 2 (display only, low risk).
2. Item 8 (guest page).
3. Item 5 (URL search).
4. Item 3 (autocomplete hotels + groups; nationality per Moshe's answer).
5. Item 6a → 6b → 6c.
6. Item 7.

Each: failing test first, typecheck/lint/test/build, code review, security review for 2, 5, 6a,
7, 8 (pricing/bookings/data scope).

## Questions for Moshe

1. Nationality: Expedia does not use it for price (point of sale only). Still add it as a
   required field (stored, shown on voucher), or skip?
2. Item 7: there is no auto-cancel and no "Vouchered" status. OK to show the panel for Confirmed
   bookings only, without auto-cancel?
3. Popularity: Expedia has no popularity data; OK to keep "Recommended" (Expedia's ranking)?
4. The notice "price depends on nationality": not added (not approved).
5. These items are not in the approved spec. How to record them: you add a section to the spec
   yourself, or approve this document as the record?
