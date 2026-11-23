# Apolles supplier layer

One internal booking model and one adapter per hotel supplier. Apolles
(CRM, quotes, vouchers) talks only to this layer. Hotelbeds, TBO, Omnibees, Dingus, SynXis,
DerbySoft, a hotel chain's own API: each one is an adapter behind the same
interface.

```
 CRM / n8n ──HTTP──▶ server (x-api-key)
                       │
                  SupplierService ── price guard, idempotency, reconciliation
                       │                └─ bookings file (BOOKINGS_FILE), alerts (ALERT_WEBHOOK_URL)
                       │
          ┌────────────┼────────────┐
      OtaAdapter   OtaAdapter    MockAdapter     (+ any custom adapter)
     (omnibees)    (dingus)
          │            │
     HttpTransport: HTTPS only, timeouts, retries (reads only), rate limit,
                    redacted audit log of every call
```

## Run

```bash
npm install
npm test
npm run build
APOLLES_API_KEY=<48 random chars> npm start
```

Config: `config/suppliers.json` (which suppliers, test/production),
`config/mappings/<supplier>.json` (our hotel id -> supplier hotel code),
secrets in environment variables (see `.env.example`). Never in git.

Environment variables:

| Variable | Meaning |
|---|---|
| `APOLLES_API_KEY` | Required. 24+ characters. The placeholder from `.env.example` is refused. |
| `BOOKINGS_FILE` | Where bookings are kept. Required when `NODE_ENV=production`. |
| `ALERT_WEBHOOK_URL` | Optional https webhook for "a person must look at this". |
| `AUDIT_DIR` | Audit log directory (default `audit-logs`). |
| `AUDIT_RETENTION_DAYS` | Days to keep audit day files (default 730). |
| `AUDIT_MAX_BODY_KB` | Largest body kept per audit entry (default 256). |
| `SUPPLIERS_CONFIG`, `MAPPINGS_DIR`, `PORT`, `HOST` | Paths and listen address. |

The configuration is checked when the service starts. It refuses to start,
with one line saying why, when: a value in `suppliers.json` has the wrong
type (a non-numeric `maxPriceIncreasePercent` used to switch the price guard
off silently) or an unknown name; a secret of an enabled supplier is
missing; `environment` does not match the base URL host (a test host
declared as production, or a known production host declared as test); a
mapping file is broken or the mappings directory is missing; the audit
directory or the bookings file cannot be written.

## API

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/v1/search` | `SearchRequest` | offers from all suppliers + per-supplier status + `unmappedHotelIds` |
| POST | `/v1/quotes` | `{ offerId }` | fresh price/policy from the supplier (`priceChanged`) |
| POST | `/v1/bookings` | `BookRequest` | booking answer |
| GET | `/v1/bookings/:clientReference` | | booking answer |
| POST | `/v1/bookings/:clientReference/cancel` | | booking answer |
| POST | `/v1/bookings/:clientReference/resolve` | `{ status, note, supplierBookingRef? }` | booking answer |
| POST | `/v1/reconcile` | | checks every booking that waits for a supplier answer (also runs every minute) |
| GET | `/health` | | `{ ok, auditOk, storeOk }` (no API key needed) |

Types: `src/core/types.ts`. Money is always `{ minor, currency }` (integer cents).

### How to read a booking answer

Every booking answer is the booking record plus two fields a caller must check:

- **`booked`**: `true` only when the supplier confirmed the booking
  (`status` is `CONFIRMED`). For every other status it is `false`.
  `POST /v1/bookings` answers HTTP 201 also for `FAILED`, `UNKNOWN` and
  `NEEDS_REVIEW` (kept as it was, a CRM may depend on it), so **do not use
  the HTTP status to decide whether there is a booking. Use `booked`.**
- **`environment`**: `"test"` or `"production"`. A test booking is not a real
  reservation. Offers and quotes carry `environment` too.

| `status` | `booked` | Meaning | What to do |
|---|---|---|---|
| `CONFIRMED` | true | Supplier confirmed. | Issue the voucher. Check `reviewReason` first. |
| `ON_REQUEST` | false | Supplier accepted, the hotel still has to confirm. | Wait. It is re-checked every 15 minutes (for about two days), then goes to `NEEDS_REVIEW`. |
| `FAILED` | false | Not booked. | Safe to book again with a new quote and a new reference. |
| `UNKNOWN` | false | We do not know yet (timeout). | Do nothing. It is checked with the supplier every minute. Never book again while it is `UNKNOWN`. |
| `NEEDS_REVIEW` | false | The service could not settle it. | A person checks with the supplier, then calls `/resolve`. |
| `CANCELLED` | false | Cancelled. | |

Other fields: `reviewReason` (text; set when a person should look at the
booking even though it has a status, see below), `cancelOutcomeUnknown`
(a cancel was sent and its outcome is not known yet), `approvedTotal`,
`history` (every status change with a note).

**Price after booking.** The supplier's final total is kept as the truth.
If it is above the approved total (beyond `maxPriceIncreasePercent`) or in
another currency, the booking keeps its status and gets a `reviewReason`,
and an alert goes out.

**Cancel.** Two cancels of the same booking at the same time reach the
supplier once. If the supplier does not answer the cancel (timeout, 5xx)
the booking is looked up at the supplier: cancelled there means
`CANCELLED`; still active there means HTTP 409 `CANCEL_NOT_DONE` and the
booking stays as it was (try again). If that is unclear too, the answer is
`NEEDS_REVIEW` with `cancelOutcomeUnknown: true`; the service keeps asking
the supplier, and the cancel may simply be sent again.

**Settling by hand.** `POST /v1/bookings/:ref/resolve` with
`{ "status": "CONFIRMED" | "CANCELLED" | "FAILED", "note": "what was checked", "supplierBookingRef": "..." }`
settles a `NEEDS_REVIEW` booking after a person checked with the supplier.
The note is written to the history. `supplierBookingRef` is required for
`CONFIRMED` when the service does not know it yet.

### Rules for requests

- **`clientReference`**: 6 to 20 characters, letters, digits and `-`. It is
  upper-cased on arrival (`apl-bk-1` and `APL-BK-1` are the same booking).
  Underscores and anything longer than 20 characters are refused with 400
  (20 is the Hotelbeds limit; one rule for all suppliers).
- The same `clientReference` again with the **same** `quoteId` returns the
  same booking. With a **different** `quoteId` it is refused: 409
  `REFERENCE_REUSED`.
- A quote can be booked **once**. A second booking of the same quote under
  another reference is refused: 409 `QUOTE_ALREADY_USED`. Get a new quote.
- Every field is checked: types, lengths, allowed values, real calendar
  dates, no control characters, no unknown top-level fields. Anything wrong
  is HTTP 400 with a message that says what.
- `holder.phone`: digits, spaces, `+ - ( )`, 6 to 20 digits. `holder.email`
  must be an email address.
- A text field that contains a card number (13 to 19 digits passing the
  card check, with or without separators) is refused, also as
  `clientReference` or as a card token. The phone field and dates in free
  text are not affected.

### Search answer

`unmappedHotelIds` lists requested hotel ids that no searched supplier has a
mapping for (they were not searched). Per supplier, `unmappedHotels` counts
its unmapped ids and `failedParts` says how many parts of a split search
failed (the offers of the other parts are still returned).

## Safety rules built in

- **No double booking.** `clientReference` is the idempotency key; the same
  reference never reaches the supplier twice. The key is written to disk
  (`BOOKINGS_FILE`) before the supplier is called, so this also holds across
  a restart or a crash. A booking that was being sent when the process died
  comes back as `UNKNOWN` and is looked up at the supplier, never sent again.
- **Bookings are never retried.** A timeout / 5xx / redirect / unreadable or
  oversized answer on book becomes `UNKNOWN`. The service then asks the
  supplier (read by reference) and moves it to `CONFIRMED`, or to
  `NEEDS_REVIEW` for a person to check. It never re-sends the booking on its
  own. An error on our own side before anything was sent (missing secret, no
  card vault) is `FAILED`: nothing reached the supplier.
- **Only an explicit confirmation is `CONFIRMED`.** A supplier status that is
  missing, unknown, pending, failed or rejected never becomes `CONFIRMED`.
- **One operation per booking at a time.** Book, reconcile, cancel and
  resolve of the same reference run one after the other. The reconcile run
  never overlaps itself. A settled booking (`CONFIRMED`, `CANCELLED`,
  `FAILED`) is never taken back to an unsettled state by an older copy.
- **Price guard.** Booking is refused if the re-checked price is above what
  the client approved (`maxPriceIncreasePercent`, default 0). Whole-number
  math, no rounding surprises.
- **No card data stored or logged.** Requests carry a card token only; the
  adapter reads the card from the vault for that one call. The audit log
  masks card numbers (also written with dots), CVV/CVC, expiry, passwords
  and auth headers. Requests containing something that looks like a card
  number are refused.
- **HTTPS only** to suppliers; redirects are refused; XML with
  DOCTYPE/ENTITY is refused (XXE); answers above 20 MB are cut off while
  they are being read.
- **Cancellation deadlines are never shown later than they are.** A deadline
  the supplier sends without a time zone is placed at the earliest moment
  that day can start anywhere (00:00 at UTC+14), so free cancellation may
  appear to end up to a day early, never late. An offer whose first penalty
  date is already past is never shown as refundable.
- **Amounts are exact.** Decimal text is parsed digit by digit, currencies
  without decimals (JPY, PYG, VND, ...) are known, negative amounts and
  exponent notation are refused. One offer with an unreadable amount or
  date is dropped (with a log line), not the whole search.
- **One slow supplier never slows the search** (per-supplier timeout +
  circuit breaker).
- **Unverified profiles can't go to production.** An OTA profile must be
  marked `verified` after certification on the supplier's test environment.
- The mock supplier refuses to start when `NODE_ENV=production`.

## Alerts

Set `ALERT_WEBHOOK_URL` (https only) and the service POSTs a small JSON
there when a person has to look at something:

```json
{ "service": "apolles-suppliers", "at": "2026-11-23T10:00:00.000Z", "event": "BOOKING_NEEDS_REVIEW",
  "clientReference": "APL-BK-0001", "supplierId": "hotelbeds", "status": "NEEDS_REVIEW", "reason": "..." }
```

| `event` | When |
|---|---|
| `BOOKING_NEEDS_REVIEW` | a booking could not be settled automatically |
| `CANCEL_OUTCOME_UNKNOWN` | a cancel was sent and its outcome is unclear |
| `PRICE_MISMATCH` | the supplier's final total is above the approved one, or in another currency |
| `AUDIT_WRITE_FAILED` | the audit log cannot be written |

No guest data is sent. A webhook that fails is logged and never blocks a
booking. Without `ALERT_WEBHOOK_URL` nothing is sent: then watch
`reviewReason`, `NEEDS_REVIEW` and `GET /health` yourself.

## Audit log

One JSON line per supplier call in `AUDIT_DIR/<day>.jsonl`, already masked.
Files are 0600 and the directory 0700 (the log holds guest names). Bodies
above 256 KB are cut and the entry says so (`truncated`). Day files older
than `AUDIT_RETENTION_DAYS` (default 730) are deleted once a day. If a
write fails, the booking still goes through, an error is logged, `GET
/health` shows `auditOk: false` and an alert is sent.

## Suppliers

| Supplier | Adapter | Status |
|---|---|---|
| Hotelbeds APItude (bed bank, JSON) | `src/adapters/hotelbeds` | live on the TEST environment; **one room per booking only** (see below) |
| TBO Holidays (bed bank, JSON) | `src/adapters/tbo` | built from spec V2.1; staging credentials currently rejected (401) |
| Omnibees (OTA 2014B, SOAP) | `src/adapters/ota` + profile | profile not verified yet |
| Dingus | `src/adapters/ota` + profile | profile not verified yet |
| Mock | `src/adapters/mock` | dev/test only |

Live TBO staging check (logs go to `audit-logs/`, usable as certification logs):

```bash
npm run build
TBO_USERNAME=... TBO_PASSWORD=... node dist/tools/tbo-smoke.js            # search + prebook
TBO_USERNAME=... TBO_PASSWORD=... node dist/tools/tbo-smoke.js --book     # + fake booking, detail, cancel
```

Behind an HTTPS proxy add `NODE_USE_ENV_PROXY=1`.

## Adding a supplier

See [docs/adding-a-supplier.md](docs/adding-a-supplier.md).

## Where bookings are kept

Set `BOOKINGS_FILE` (the server deployment uses `/data/bookings/bookings.json`).
Bookings, idempotency keys and the bookings still waiting to be checked with
the supplier live in that one JSON file: written atomically after every
change, file mode 0600, its own directory 0700. With `NODE_ENV=production`
the service refuses to start without it. A corrupt or unreadable file stops
startup with a clear error; the service never starts empty over existing
data. **Back this file up.** Without `BOOKINGS_FILE` (development, tests)
bookings are in memory and are lost on restart.

The file works for ONE server instance. Two instances need Postgres. The
same goes for the "one operation per booking at a time" rule and for
single-use quotes: both are kept in the memory of the one process.

On the server the data directory must belong to the container's user:
`mkdir -p deploy/data && sudo chown -R 1000:1000 deploy/data`. If the
service cannot write there it now refuses to start (before, audit log
writes failed without a word).

## Production checklist

- [x] Bookings survive a restart (`BOOKINGS_FILE`, one instance)
- [x] Alert when a booking reaches `NEEDS_REVIEW` (`ALERT_WEBHOOK_URL`; connect it to email/WhatsApp in n8n)
- [ ] Back up `BOOKINGS_FILE` (nothing does this yet)
- [ ] Postgres implementations of `BookingStore` and audit sink (`db/schema.sql`), needed before a second instance
- [ ] Redis `OfferCache` if more than one server instance runs
- [ ] Real `CardVault` (virtual-card issuer or tokenization vault)
- [ ] Real `SecretProvider` (vault) instead of plain env vars
- [ ] Hotelbeds: verify the multi-room occupancy format live, then enable more than one room
- [ ] Static content (photos, descriptions) import per supplier
- [ ] Hotel mapping data for each supplier

## Hotelbeds (test)

1. Put the key and secret from developer.hotelbeds.com (Dashboard > My API keys)
   in `HOTELBEDS_API_KEY` / `HOTELBEDS_SECRET`.
2. `npm run build && node dist/tools/hotelbeds-smoke.js` (add `--book` for a test booking + cancel;
   behind an HTTPS proxy add `NODE_USE_ENV_PROXY=1`). Verified live 2026-11-17: search, CheckRate,
   book, lookup by clientReference, cancel.
3. Set `"enabled": true` for `hotelbeds` in `config/suppliers.json` and map hotels in
   `config/mappings/hotelbeds.json`.

Evaluation keys allow about 50 requests a day. Production stays blocked until
Hotelbeds certifies the integration (`certified: true`).

**One room per booking.** How Hotelbeds wants several rooms in one request
(totals per occupancy line, pax ages, room ids) was never verified against
the live API. Until it is, a Hotelbeds search or booking with more than one
room is refused with a clear validation error: in a multi-room search the
supplier status shows `skipped: "MULTI_ROOM_UNSUPPORTED"`. Book each room
separately. After a live test with two rooms proves the format, set
`allowUnverifiedMultiRoom` for the adapter in `src/bootstrap.ts`.
