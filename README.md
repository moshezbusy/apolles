# Apolles supplier layer

One internal booking model and one adapter per hotel supplier. Apolles
(CRM, quotes, vouchers) talks only to this layer. Omnibees, Dingus, SynXis,
DerbySoft, a hotel chain's own API: each one is an adapter behind the same
interface.

```
 CRM / n8n ──HTTP──▶ server (x-api-key)
                       │
                  SupplierService ── price guard, idempotency, reconciliation
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

## API

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/v1/search` | `SearchRequest` | offers from all suppliers + per-supplier status |
| POST | `/v1/quotes` | `{ offerId }` | fresh price/policy from the supplier (`priceChanged`) |
| POST | `/v1/bookings` | `BookRequest` | `BookingRecord` |
| GET | `/v1/bookings/:clientReference` | | `BookingRecord` |
| POST | `/v1/bookings/:clientReference/cancel` | | `BookingRecord` |
| POST | `/v1/reconcile` | | settles `UNKNOWN` bookings (also runs every minute) |

Types: `src/core/types.ts`. Money is always `{ minor, currency }` (integer cents).

## Safety rules built in

- **No double booking.** `clientReference` is the idempotency key; the same
  reference never reaches the supplier twice.
- **Bookings are never retried.** A timeout / 5xx / unreadable answer on book
  becomes `UNKNOWN`. The service then asks the supplier (read by reference)
  and moves it to `CONFIRMED`, or to `NEEDS_REVIEW` for a person to check.
  It never re-sends the booking on its own.
- **Price guard.** Booking is refused if the re-checked price is above what
  the client approved (`maxPriceIncreasePercent`, default 0).
- **No card data stored or logged.** Requests carry a card token only; the
  adapter reads the card from the vault for that one call. The audit log
  masks card numbers, CVV, expiry, passwords and auth headers. Requests
  containing something that looks like a card number are refused.
- **HTTPS only** to suppliers; XML with DOCTYPE/ENTITY is refused (XXE).
- **One slow supplier never slows the search** (per-supplier timeout +
  circuit breaker).
- **Unverified profiles can't go to production.** An OTA profile must be
  marked `verified` after certification on the supplier's test environment.
- The mock supplier refuses to start when `NODE_ENV=production`.

## Adding a supplier

See [docs/adding-a-supplier.md](docs/adding-a-supplier.md).

## Production checklist (not done yet)

- [ ] Postgres implementations of `BookingStore` and audit sink (`db/schema.sql`)
- [ ] Redis `OfferCache` if more than one server instance runs
- [ ] Real `CardVault` (virtual-card issuer or tokenization vault)
- [ ] Real `SecretProvider` (vault) instead of plain env vars
- [ ] Alert (email/WhatsApp) when a booking reaches `NEEDS_REVIEW`
- [ ] Static content (photos, descriptions) import per supplier
- [ ] Hotel mapping data for each supplier
