# Hotelbeds as a second supplier (through the supplier layer)

Owner decision, 2026-11-23 (in chat): connect Hotelbeds next to Expedia, through the supplier
layer service; hotel mapping only from a list an admin approved; one price per room (the cheapest);
the supplier stays hidden from agents and clients. Until Hotelbeds gives a USD account, staging may
convert Hotelbeds prices to USD at a fixed, temporary rate. Production never converts.

## The design in short

- The supplier layer (container `apolles-suppliers`, `http://apolles-suppliers:8080`, key in
  `x-api-key`) already talks to Hotelbeds. The platform gets one new adapter,
  `src/server/supplier/hotelbeds-layer/`, that speaks the layer's HTTP API and returns the
  platform's own supplier model (Offer, PriceCheckResult, RetrievedItinerary). Nothing else in
  the platform knows Hotelbeds or the layer.
- `SUPPLIERS` turns it on: `expedia,hotelbeds` (or `fake,hotelbeds` for the staging demo). Unset,
  the platform is exactly as before: Expedia only (or the fake, by `SUPPLIER_MODE`).
- Hotels: the platform's hotel list is still Expedia's catalog. A hotel gets Hotelbeds rates
  only when an admin approved the link "this hotel = this supplier-layer hotel id" on
  `/admin/hotel-mapping` (table `SupplierHotelMap`). Proposed and rejected links are never
  searched.
- Every offer, stored search rate and booking carries its supplier (`supplier`, "expedia" for
  every existing row and for the fake). Every later step of a booking goes to the booking's own
  supplier, whatever `SUPPLIERS` says later.

## Each step for a Hotelbeds offer

1. **Search.** The same batch of 250 hotels goes to Expedia (or the fake) and, for the hotels
   with an approved link, to the layer, at the same time. Offers are merged per hotel. When two
   suppliers offer the same room type, board and refundability, only the cheaper offer is kept
   (a tie keeps Expedia's). Room types are matched by a normalised room name, boards by the
   words of the rate; when names differ both offers stay, as two rates. A layer failure or
   timeout never fails the search: the Expedia results are shown alone. Only one-room searches
   ask the layer (the layer books one room per booking).
2. **Review (price check).** `POST /v1/quotes {offerId}`. A quote in the wrong environment, a
   rate no longer offered, an expired offer (20 minutes) or a changed cancellation policy is
   "sold out": the agent searches again. A changed price is shown old against new, as with
   Expedia. The book token is the quote id plus the quoted total in the layer's own currency.
3. **Book.** `POST /v1/bookings` with our reference as `clientReference`, the quote id, the
   quoted total as `approvedTotal`, the lead guest and every guest of the room, and payment
   `AGENCY_CREDIT`. The answer's `booked` decides, never the HTTP status: `booked: true` is a
   booking; `FAILED` is a definite no (the hold is released); any other status (`UNKNOWN`,
   `ON_REQUEST`, `NEEDS_REVIEW`) is "the layer has it, not settled yet", and the booking waits
   with the money held. A refusal before anything was stored at the layer (HTTP 400, 401, 410,
   409 except `REFERENCE_REUSED`) is a definite no. Everything else (timeout, network, 5xx,
   `REFERENCE_REUSED`, an answer that does not read) is "outcome unknown": never booked again,
   checked later.
4. **Reconcile.** `GET /v1/bookings/:ref`. `CONFIRMED` is booked (a `reviewReason` there flags
   the booking for an admin as well), `ON_REQUEST`/`UNKNOWN`/`PENDING` wait, `CANCELLED` or
   `FAILED` is not booked, `NEEDS_REVIEW` flags the booking for an admin with the money held.
   HTTP 404 is "not found" (the same rules as Expedia apply).
5. **Cancel.** `POST /v1/bookings/:ref/cancel`. `CANCELLED` is done (refund as usual, from the
   rate's penalties); `CANCEL_REFUSED` and `CANCEL_NOT_DONE` are a definite no (the booking is
   confirmed again and the agent told); an unclear answer is checked by the background check,
   which reads the booking at the layer.
6. **Daily supplier check and "Check with the supplier now"** read each booking at its own
   supplier. A supplier that does not answer five times in a row is skipped for the rest of the
   run; the others are still checked.

## Money

- Integer minor units only. The layer's offer total is the whole stay; it becomes one
  "room rate" line. Fees to pay at the hotel become "due at the property".
- Production: only USD Hotelbeds rates are kept; anything else is dropped (as Expedia).
- **Staging only, temporary:** `HOTELBEDS_FX_CURRENCY` (e.g. `EUR`) and `HOTELBEDS_FX_TO_USD`
  (e.g. `1.0850`) convert that one currency to USD, plus a safety margin
  (`HOTELBEDS_FX_MARGIN_PERCENT`, default 2), with whole-number maths, always rounded up. The
  app refuses to start with these set and `APP_ENV=production`, and the conversion refuses to
  run there too. Penalties are converted the same way, so a full penalty stays the full price.
- Cancellation penalties: the layer's "from this moment it costs X" becomes a penalty window
  from that moment to the next one (the last one ends at midnight UTC of check-in), keeping the
  supplier's own date and offset.

## Booking reference

The platform's reference is `APL-` and 8 characters from A-Z (no I, O) and 2-9: 12 characters of
upper case letters, digits and "-". It already fits the layer's rule (6 to 20 characters,
A-Z 0-9 "-"), so it is sent as it is. The adapter checks the rule and sends nothing otherwise.

## What is staging-only now

- The currency conversion (until the USD account).
- The layer's Hotelbeds side runs in TEST mode: the app only accepts `environment: "test"`
  answers outside production, and only `"production"` answers in production.

## Before production

1. A USD-priced Hotelbeds account (then remove the conversion settings).
2. Hotelbeds certification of the layer (the layer refuses production until `certified`).
3. A review of every approved mapping by the owner.
4. The layer's production checklist (bookings file backup, alerts).

## Open questions

- Room types across suppliers are matched by name only. A real room mapping would merge more.
- The layer's cancellation fee is not compared with our own charge; our charge comes from the
  penalties shown at booking time.
- Hotelbeds remarks (rate comments) are not shown yet.
- Candidate suggestions on the mapping page: the layer exposes only ids (no names or
  coordinates), so there is nothing to compare without a new call. Left for later.
- Several rooms with Hotelbeds wait for the layer's live multi-room test.
