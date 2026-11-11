# Plan 2c: search, results and hotel screens (07, 08, 09)

Spec: `docs/specs/approved/2026-11-08-apolles-design.md`, section 3 rows 4–6 and section 6.
Backend from plan 2b: `src/server/search/*`, `src/server/content/*`.

## Decisions (Claude, owner delegated)

- **No nationality field.** Rapid has no nationality parameter. The spec was checked
  (`rapid-3-specs.yaml`: no match). Per the checklist-alignment decision, the field is dropped.
  `country_code` stays the agency's country.
- **No map** on results (spec) or on the hotel page (no map provider in scope).
- **No per-night price.** That figure would mean dividing and rounding Expedia's total (BP5).
  Every card shows the total for the stay, as Expedia gives it.
- **Supplier text is shown as plain text.** Descriptions and policies may contain HTML. A small
  converter turns them into paragraphs and list items, and React escapes them. No HTML from the
  supplier ever reaches the page, and no new dependency is needed.
- **Images only from `i.travelapi.com`** over https; any other host is dropped.
- **"Book room" leads to guest details** (plan 3). Until plan 3 the button is shown but
  disabled ("Booking opens in the next step"). It carries only rate and bed-group ids. The
  price-check token never reaches the browser.
- **Fake supplier for development and e2e only.** `SUPPLIER_MODE=fake` works only when
  `APP_ENV` is `development` or `test`. Anywhere else, starting the app with it is refused.
- **Phase 2 items left out:** recent searches, "needs attention", "Add to quote", meal-plan
  filter, the quote rail.
- **Agents land on /search after login.** The header's "Search" becomes a real link.

## Tasks (each: failing test → code → green)

1. **Plain-text and image helpers.**
   - `src/lib/supplier-text.ts` → `toBlocks(html)`: paragraphs and list items, with entities
     decoded and tags, script and style removed.
   - `src/lib/supplier-image.ts` → `safeImageUrl(url)`.
2. **Results query additions.**
   - Add `SearchHotel.roomNames` (lowercased, newline-joined room names; migration) for the
     room-name filter.
   - Add a free-cancellation filter.
   - Add a strict Zod `listOptionsSchema` that parses URL search params; prices come in as
     USD and are converted to minor units with integer math.
3. **Fake supplier.** `src/server/supplier/fake.ts` with deterministic offers, plus a
   `supplierAdapter()` factory with the APP_ENV guard. The search service uses the factory.
4. **Search page (07) + destination suggestions.**
   - `GET /search/destinations?q=`: agent session, rate limit 120/min/agency, JSON.
   - Search form (client): destination combobox, check-in/check-out with nights shown, adults,
     children and the age of each child (SP1).
   - Server action `startSearchAction`: Zod parse, supplier context (IP, user agent), redirect
     to results. Error states: invalid, rate limited, unavailable (screen 24 wording).
5. **Results page (08).**
   - `/search/[id]`, scoped to the agency.
   - Filters form (GET): hotel name, room name, price min/max, stars, free cancellation, sort.
   - Hotel cards: image, name, city, stars, "from" total and its nights/guests, a "Free
     cancellation available" tag, and "View rooms".
   - "Load more" (server action), a loading state, "results expired → search again", and an
     empty state.
6. **Hotel page (09).**
   - `/search/[id]/hotels/[propertyId]`, rate limit 120/min/agency.
   - Header with photos, stars and address.
   - Room table, one row per offer:
     - bed groups (a choice when there are several), plus "Bed type is a request and not
       guaranteed" (AP1);
     - a Non-refundable label (AP2);
     - the full cancellation policy with `nonrefundable_date_ranges` (BP3);
     - the total, with Room and "Taxes and fees" lines (BP5);
     - fees due at the property in USD and the local currency (BP4).
   - Policies block in one area (AP3): check-in, check-out, instructions, special
     instructions, fees, know before you go.
   - Description and amenities.
7. **Header and login:** "Search" link; agent login redirects to `/search`.
8. **e2e:**
   - seed a destination, hotels and content;
   - the agent searches, filters, opens a hotel and sees the policies and fee lines.
9. **Checks:** typecheck, lint, test, build, e2e; security review; PR.
