# Plan 10: several rooms in one search and booking

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** an agent searches and books up to 8 rooms of the same room type and rate in one booking, each room with its own guests, and cancels the booking room by room at the supplier.

**Architecture:** the supplier model carries a list of occupancies (one per room) instead of one; an offer's price is the sum of the per-room prices Expedia returns, and the per-room prices travel with it. A booking stays one Rapid itinerary; a new `BookingRoom` table holds each room's guests, price, supplier room id, hotel confirmation, cancel link and status. The booking's existing columns keep the totals (all adults, all children, all guests, the total price), so every screen and document that shows totals stays right.

**Tech Stack:** Next.js 16 server actions, Prisma 7 (Postgres), Zod, Vitest (`renderToStaticMarkup` page tests, real local test DB), pdfkit.

**Spec:** `docs/specs/approved/2026-11-08-apolles-design.md` (section 3: several rooms is phase 2; section 6: Expedia requirements, TR5, TR6) and `docs/decisions/2026-11-17-build-all-mockup-screens.md`. Owner, 19.11.2026 in chat: "there must be an option to choose more than one room", then "start" (no questions; Claude decides).

## Global Constraints
- One supplier: Expedia Rapid, behind the adapter (`src/server/supplier/`). Services and UI never see Expedia field names.
- Expedia rules (Rapid spec `docs/research/expedia-api/rapid-3-specs.yaml`):
  - "To request multiple rooms (of the same type), include one instance of occupancy for each room requested. Up to 8 rooms may be requested or booked at once." (l. 5018).
  - `occupancy_pricing` is "A map of room information by occupancy" (l. 25764).
  - Booking `rooms[]` has one entry per room with `given_name`/`family_name` of that room's main guest (l. 27226; TR5: must match the main guest checking in to each room).
  - Cancel is per room: `DELETE /itineraries/{id}/rooms/{room_id}` from the room's own `links.cancel` (l. 16246, 26818). Never build that URL; follow the link.
  - TR6: "Each room that is booked will create a separate Confirmation ID ... To cancel all rooms, complete a cancellation call for every confirmation ID within the itinerary."
- Limits: 1 to 8 rooms. Per room: 1 to 8 adults, 0 to 6 children aged 0 to 17 (today's per-room limits). The server checks everything again.
- **Gate (Claude's call):** more than one room is allowed only while the fake supplier is on (`isDemoSupplier()`, staging demo and tests). With the real supplier the server refuses more than one room ("Several rooms are not available yet"), and the form shows no "Add room". Why: the Rapid spec does not say how two identical occupancies are keyed in `occupancy_pricing`, whether the price under a key is for one room, or how the multi-room total is checked; that must be tried on Expedia's test system first (no test keys yet). The open items are listed under "Verify with Expedia test keys" below.
- Money: integer minor units; the total of a booking is the sum of its rooms' Expedia totals (addition only: no rounding, no conversion, BP5). `sum(rooms.totalMinor) === booking.totalMinor` always; code that writes either checks it.
- Idempotency: one hold for the booking total (`booking:{id}:hold`), one capture, one refund for the whole cancellation (`booking:{id}:refund`), as today. A retry never books or charges twice.
- Booking states: unchanged enum and transitions (`src/server/booking/states.ts`). Room states are a new enum on `BookingRoom` (`ACTIVE`, `CANCELLED`); room changes happen inside the same transaction as the booking's own change, and each writes a `BookingEvent` (`reason` names the room: "Room 2 of 3 cancelled at the supplier").
- Every query scoped by `agencyId`; every server action checks the session and role; Zod at every boundary, unknown fields rejected.
- Existing one-room bookings, stored search snapshots and recent searches keep working (old shapes read as one room).
- UI copy in English, as the rest of the app. Mobile rules of plan 9 hold (16px fields, `data-label` on table cells).

## Decisions (Claude)
- Same room type and rate for every room (Expedia allows nothing else).
- Main guest of each room = that room's first adult (TR5). The booking's lead guest (contact email and phone) = room 1's main guest, as today.
- Cancelling cancels **every room** of the booking (one supplier call per room, in room order). Cancelling one room while keeping the others is **not** in this plan (plan 10b, with quotes): it needs a partial refund and a booking that stays confirmed with fewer rooms.
- Quotes stay one room: on a search with more than one room, "Add to quote" is replaced by "Quotes are for one room for now." Book-from-quote is unchanged.
- Cancellation charge: computed per room from the rate's penalties on that room's own total (`cancelChargeAt` per room), summed. The refund is the paid total minus that sum, as today.
- After a successful book, the service retrieves the itinerary once (best effort) to store each room's supplier room id, hotel confirmation and cancel link, matched to our rooms by order and checked against the main guest's name; a mismatch sets `needsAttention`. If the retrieve fails, the reconcile job and the cancel path fill them later (cancel already retrieves when a link is missing).

## Verify with Expedia test keys (before the gate opens for the real supplier)
1. Two identical occupancies (`occupancy=2&occupancy=2`): how `occupancy_pricing` keys them, and whether the price under a key is for one room.
2. One price check covers every room; its `occupancy_pricing` holds every occupancy.
3. The order of `rooms[]` in the book request and in the retrieve matches the order of the occupancies.
4. Per-room `cancel_penalties` amounts after booking (retrieve) against the rate's penalties at shopping.
5. TR6 logs: book and cancel a 2-room test booking and keep the request/response logs (the supplier call log already stores them).
6. Guest names in the retrieve: whether Rapid returns `given_name`/`family_name` per room exactly as sent (accents, non-Latin letters). Rooms are matched by order and checked by name; a changed name flags a good booking for an admin.
7. Penalty timing: rooms after the first (or a cancel sent later by the reconcile job) may reach Expedia after a penalty window started; the agent's charge was fixed when they asked. Check how far apart the calls land and whether an admin flag is needed.

---

### Task 1: Supplier model and Expedia adapter take several rooms

**Files:**
- Modify: `src/server/supplier/types.ts`, `src/server/supplier/expedia/adapter.ts`, `src/server/supplier/expedia/booking.ts`, `src/server/supplier/fake.ts`, `src/lib/supplier-money.ts` (only if a sum helper is missing), callers that build an `AvailabilityQuery` or `BookInput` (search and booking services: pass one room, as today, so the app still compiles and behaves the same).
- Test: `src/server/supplier/expedia/adapter.test.ts`, `src/server/supplier/expedia/booking.test.ts`, `src/server/supplier/fake.test.ts` (create if missing), new fixtures `src/server/supplier/expedia/fixtures/availability.multi-room.json`, `price-check.multi-room.json`, `retrieve.multi-room.json` (shaped like the existing fixtures and the spec examples).

**Interfaces:**
- Produces:
  - `AvailabilityQuery.occupancies: Occupancy[]` (1 to 8; replaces `occupancy`).
  - `Offer.price: PriceBreakdown` = the sum over rooms; new `Offer.roomPrices: PriceBreakdown[]` (one per occupancy, same order).
  - `PriceCheckResult` available/price_changed: `price` (sum) and `roomPrices: PriceBreakdown[]`.
  - `sumBreakdowns(parts: PriceBreakdown[]): PriceBreakdown` exported from `src/server/supplier/price.ts` (new): totals and lines added by kind, `dueAtProperty` added by kind (localAmount kept only when every part has one in the same currency, else null), `dueAtPropertyTotal` added (null if any part has none), `nights` from the first part (all parts must agree, else throws).
  - `ref` of `priceCheck` gets `occupancies: Occupancy[]` so the adapter can map each room to its `occupancy_pricing` key.
  - `BookInput.rooms: { givenName: string; familyName: string }[]` (1 to 8, room order) in addition to `lead` (email, phone stay on `lead`).
  - `RetrievedItinerary.rooms[]` gains `givenName: string | null`, `familyName: string | null`.
- Consumes: nothing new.

- [ ] **Step 1: Write the failing tests**
  - adapter: `searchAvailability` with two occupancies sends `occupancy` twice in order (`["2-9,4", "2"]`); an offer's `roomPrices` has the two keys' breakdowns in order and `price.total.minor` is their sum; a rate missing one of the requested keys is dropped (no offer); two identical occupancies (`["2","2"]`) read the same key twice and the total is twice the key's total.
  - adapter: `priceCheck` with two occupancies returns `roomPrices` per occupancy and the sum; a missing key → `SupplierResponseInvalid`.
  - `sumBreakdowns`: two parts add totals and lines (`room_rate` 10000+12000, `taxes_and_fees` 1500+1800); different `nights` throws; one part without `dueAtPropertyTotal` gives null.
  - booking: `book` with two rooms sends `rooms: [{given_name:"Dana", family_name:"Levi", smoking:false}, {given_name:"Avi", family_name:"Cohen", smoking:false}]`, the special request only on room 1.
  - booking: `toItinerary` maps each room's `given_name`/`family_name`.
  - fake: two occupancies give `roomPrices.length === 2` and a total equal to their sum; one occupancy gives exactly today's prices (existing tests stay green).
- [ ] **Step 2: Run them; they fail** — `pnpm exec vitest run src/server/supplier`
- [ ] **Step 3: Implement.** One occupancy key per room via `occupancyKey`; the query param becomes an array. `toOffer` takes the list of keys. Callers pass `occupancies: [one]` for now.
- [ ] **Step 4: Run `pnpm exec vitest run src/server/supplier` and `pnpm typecheck`; all pass.**
- [ ] **Step 5: Commit** `Plan 10 task 1: supplier model and Expedia adapter take several rooms`

### Task 2: Search takes several rooms (input, snapshot, recent searches, form)

**Files:**
- Modify: `src/server/search/input.ts`, `src/server/search/search.ts`, `src/server/search/recent.ts`, `prisma/schema.prisma` (`RecentSearch.rooms Json?`), new migration `prisma/migrations/<timestamp>_plan10_search_rooms/migration.sql`, `src/server/supplier/index.ts` (new `multiRoomAllowed(): boolean`, true only when `isDemoSupplier()`), `src/app/(agent)/search/search-form.tsx`, `form-state.ts`, `dates.ts`, `actions.ts`, `page.tsx`, `parts.tsx` (`stayText`, `formValuesOf`), `src/app/(agent)/search/[id]/page.tsx` and `hotels/[propertyId]/page.tsx` (stay text, "Price · …"), `src/app/(agent)/quotes/add-to-quote.tsx` callers (hide on several rooms).
- Test: `src/server/search/search.test.ts`, `src/server/search/recent.test.ts`, `src/app/(agent)/search/search-form.test.tsx`, `src/app/search-pages.test.tsx`.

**Interfaces:**
- Consumes: Task 1 `AvailabilityQuery.occupancies`.
- Produces:
  - Search input (`searchInputSchema`): `{ destinationId, checkin, checkout, rooms: { adults: number; childAges: number[] }[] }` (1 to 8 rooms; per room 1-8 adults, ≤6 children 0-17), `.strict()`. More than one room when `!multiRoomAllowed()` → the action answers "Several rooms are not available yet."
  - `SearchSnapshot.query` stores `rooms`; a stored query with top-level `adults`/`childAges` reads as `rooms: [{adults, childAges}]` (helper `roomsOfQuery(query): Occupancy[]` in `search.ts`, used everywhere the snapshot query is read).
  - `SearchSummary.rooms: Occupancy[]` (keep `adults` and `childAges` as totals for existing callers).
  - `findOffer()` also returns `rooms: Occupancy[]`.
  - `stayText({ nights, rooms })` → `"3 nights, 2 rooms, 4 adults, 1 child"`; one room keeps today's text (`"3 nights, 2 adults"`).
  - Form fields: `rooms` as repeated groups `room_adults` + `room_children` (`"9,4"`) per room, parsed in `readSearchForm` into `SearchFormValues.rooms: { adults: string; childAges: string[] }[]`; `childCount`/`childAge` are gone.
  - `RecentSearch.rooms` (Json, nullable): written for new searches; old rows (null) read as one room from `adults`/`childAges`; `adults`/`childAges` keep the totals.
- UI (mockup 07 "Rooms and guests"): the summary reads "2 rooms · 5 guests"; inside, one block per room ("Room 1") with Adults and the plan 9 children-by-age picker, "Remove room" from room 2 on, "Add room" up to 8 (only when `multiRoomAllowed`, passed as a prop from the server page); "Same room type for all rooms." note when more than one room.

- [ ] **Step 1: Failing tests:** input accepts 2 rooms and refuses 9, a room with 0 adults, 7 children, and an unknown field; real-supplier mode refuses 2 rooms; an old snapshot query `{adults:2, childAges:[]}` reads as one room; `stayText` texts above; the form renders "Room 1"/"Room 2" blocks with hidden inputs per room, "Add room" only with `multiRoomAllowed`; recent search with 2 rooms round-trips and an old row reads as one room.
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement** (search service passes `occupancies: rooms` to the supplier).
- [ ] **Step 4: `pnpm exec vitest run src/server/search "src/app/(agent)/search" src/app/search-pages.test.tsx` and `pnpm typecheck` pass.**
- [ ] **Step 5: Commit** `Plan 10 task 2: search takes several rooms`

### Task 3: Bookings have rooms (model, draft, guest details, review, book, confirm, reconcile)

**Files:**
- Modify: `prisma/schema.prisma` (new `BookingRoom` model and `BookingRoomStatus` enum; `Booking.rooms BookingRoom[]`), new migration `<timestamp>_plan10_booking_rooms` that creates the table **and backfills one room per existing booking** from the booking's own fields (`adults`, `childAges`, `guests`, `leadGivenName`, `leadFamilyName`, `totalMinor`, `price`, `supplierRoomId`, `hotelConfirmationId`, `supplierLinks->>'cancel'`, status `CANCELLED` when the booking is `CANCELLED`/`CANCELLED_BY_SUPPLIER`, else `ACTIVE`); `src/server/booking/service.ts`, `src/app/(agent)/book/form-state.ts`, `src/app/(agent)/book/new/page.tsx`, `guest-form.tsx`, `src/app/(agent)/book/actions.ts`, `src/app/(agent)/book/[id]/page.tsx`, `src/lib/guests.ts`.
- Test: `src/server/booking/service.test.ts`, `src/app/booking-pages.test.tsx`, migration check in a new `src/server/booking/rooms.test.ts`.

**Interfaces:**
- Consumes: Task 1 (`roomPrices`, `BookInput.rooms`, retrieve names), Task 2 (`findOffer().rooms`).
- Produces:
  - `model BookingRoom { id String @id @default(cuid()); bookingId String; index Int /* 0-based room order */; adults Int; childAges Int[]; guests Json /* [{givenName, familyName, title?}] main guest first */; givenName String; familyName String; totalMinor Int; price Json; supplierRoomId String?; hotelConfirmationId String?; cancelLink String? /* server-only */; status BookingRoomStatus @default(ACTIVE); cancelledAt DateTime?; booking Booking @relation(..., onDelete: Restrict); @@unique([bookingId, index]) }`.
  - Draft input: `rooms: { guests: Guest[] }[]` (one per searched room, guests per room = that room's adults + children); the booking's `guests` = all rooms' guests flattened in room order; `adults`/`childAges` = totals; `totalMinor`/`price` = the offer's sum; each `BookingRoom.totalMinor`/`price` from `roomPrices[i]`.
  - Guest form fields per room: `r{room}_given_{i}`, `r{room}_family_{i}`, `r{room}_title_{i}`; sections "Room 1 · 2 adults, 1 child". One contact block (lead) and one special request for the whole booking (sent on room 1 only).
  - Review price check passes `occupancies`; on a new price the rooms' prices update with the booking's, in the same transaction; the sum check holds.
  - `book()` sends `rooms` (main guest per room). After `confirmBooking`, `fillRoomsFromSupplier(bookingId)` (best effort, swallows supplier errors, logs) retrieves once and stores per-room `supplierRoomId`, `hotelConfirmationId`, `cancelLink`, matched by order and checked by main guest name; a count or name mismatch sets `needsAttention` and stores nothing for the mismatched rooms. Reconcile (PENDING_CONFIRMATION) uses every room: confirmed when every room is booked; any room cancelled or missing at the supplier → `needsAttention` (never auto-fail a booking with some rooms booked).
  - Single-room bookings behave exactly as before (existing tests stay green).
- [ ] **Step 1: Failing tests:** a 2-room draft stores two `BookingRoom` rows with guests, prices summing to the booking total; a draft whose room guest count does not match its occupancy is refused; the book call sends two rooms' main guests; after confirm, per-room supplier ids and confirmations are stored from the retrieve; a retrieve with the names swapped sets `needsAttention`; the guest page shows "Room 1"/"Room 2" sections; the review page lists both rooms; the migration backfill (run on the test DB) gives every existing booking exactly one room.
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: `pnpm exec vitest run src/server/booking src/app/booking-pages.test.tsx` and `pnpm typecheck` pass.**
- [ ] **Step 5: Commit** `Plan 10 task 3: bookings have rooms`

### Task 4: Cancelling cancels every room

**Files:**
- Modify: `src/server/booking/service.ts` (cancel quote, cancel, reconcile CANCEL_PENDING, finishCancel), `src/server/booking/cancel-charge.ts`, `src/app/(agent)/bookings/[id]/page.tsx` (cancel dialog totals), `src/app/(agent)/bookings/[id]/actions.ts`.
- Test: `src/server/booking/service.test.ts`, `src/server/booking/cancel-charge.test.ts`, `src/app/booking-pages.test.tsx`.

**Interfaces:**
- Consumes: Task 3 rooms with `cancelLink`, `status`.
- Produces: `cancelQuote(booking)` = sum over ACTIVE rooms of `cancelChargeAt(room.totalMinor, penalties, checkin, now)`; refund = paid − sum (never below 0, never above paid). `cancel()`: CONFIRMED→CANCEL_PENDING once; then for each ACTIVE room in order: get its link (retrieve once if any is missing), `cancelRoom(link)`; a 204 sets that room CANCELLED in a transaction with a `BookingEvent`; an unknown answer stops the loop and leaves the rest to reconcile. When every room is CANCELLED, `finishCancel` (one refund credit, as today). Reconcile CANCEL_PENDING: retrieve; mark supplier-cancelled rooms CANCELLED; send the cancel again for rooms still booked whose last try is unknown only by the existing rules (never twice for one room inside one run); when all are cancelled → finishCancel.
- [ ] **Step 1: Failing tests:** 2-room booking: cancel calls `cancelRoom` twice with each room's own link, both rooms CANCELLED, one refund ledger row, booking CANCELLED; first room 204 and second unknown → booking CANCEL_PENDING with room 1 CANCELLED, then reconcile with both cancelled at the supplier finishes with one refund; a retry of the cancel action never cancels a room twice; the charge is the per-room sum.
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: `pnpm exec vitest run src/server/booking src/app/booking-pages.test.tsx` passes.**
- [ ] **Step 5: Commit** `Plan 10 task 4: cancelling cancels every room`

### Task 5: Rooms on every page and document

**Files:**
- Modify: `src/app/(agent)/bookings/[id]/page.tsx` (a "Rooms" card: each room with its guests, main guest, hotel confirmation, price, status), `src/app/(agent)/bookings/page.tsx` + `src/server/booking/list.ts` (rows and CSV show "N rooms" when more than one), `src/server/booking/voucher.ts` (one voucher; a block per room with its guests and hotel confirmation), `src/server/booking/statement.ts` (a line per room), `src/server/booking/emails.ts`, `src/server/booking/client-email.ts` (rooms listed), `src/app/admin/bookings/[id]/page.tsx` + `src/server/admin/bookings.ts` (a rooms table: index, guests, supplier room id, hotel confirmation, status, price), `src/app/(agent)/search/[id]/page.tsx` + `hotels/[propertyId]/page.tsx` ("Add to quote" replaced on several rooms).
- Test: `src/server/booking/voucher.test.ts`, `statement.test.ts`, `emails.test.ts`, `client-email.test.ts`, `list.test.ts`, `src/server/admin/bookings.test.ts`, `src/app/booking-pages.test.tsx`, `src/app/admin-booking-pages.test.tsx`, `src/app/search-pages.test.tsx`.

**Interfaces:**
- Consumes: Task 3 `BookingRoom`.
- Produces: no new server API; reads `booking.rooms` ordered by `index`. One-room bookings look as before (no "Room 1" heading).
- [ ] **Step 1: Failing tests:** each document and page shows both rooms' guests and both hotel confirmations for a 2-room booking, and is unchanged for a 1-room booking; the bookings list shows "2 rooms"; the admin page lists both supplier room ids; a several-room search shows "Quotes are for one room for now." instead of "Add to quote".
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: `pnpm test`, `pnpm typecheck`, `pnpm lint` pass.**
- [ ] **Step 5: Commit** `Plan 10 task 5: rooms on every page and document`

### Task 6: Check end to end (controller, not a subagent)
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- Local demo data: search 2 rooms (2 adults; 1 adult + child 7), book, see the booking page, voucher and statement, cancel, check the wallet ledger (one hold, one charge, one refund), and the admin booking page; phone screenshots at 390px.

## Review Focus
- A booking whose rooms' totals do not add up to the booking total must never be held or charged (check before the hold).
- A cancel retried after a timeout must not send a second DELETE for a room already cancelled.
- Old one-room bookings (no `BookingRoom` before the migration) must show and cancel exactly as before: the backfill covers them, and the cancel path still works if a room has no link (retrieve fallback).
- A form post with more rooms than the search had, or guests in the wrong room, is refused on the server.
- The real supplier never receives more than one occupancy (the gate is checked on the server, not only hidden in the form).
