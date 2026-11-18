# Plan 5b: Quotes list and quote editor (screens 14, 15)

Owner decision 2026-11-17 (`docs/decisions/2026-11-17-build-all-mockup-screens.md`). Mockups:
`docs/design/mockups/pages/14-quotes.html`, `15-quote-editor.html`. Owner answers in chat 2026-11-17:
client page in USD only; sending by WhatsApp and email; client link on the Apolles address. Those are
plan 5c (client page, sending, selections). Booking from a quote is plan 5d.

## Decisions (Claude)

- **One room per quote**, like a booking in phase 1 (spec section 3: several rooms is phase 2 of booking).
  The quote holds the guests (adults, children's ages); every destination uses them.
- **A room option is a copy of one rate of a search** (snapshot): room, bed type, board text, refundable,
  the supplier's last free-cancellation day, the net total and the price breakdown. It is read on the
  server from the agency's own search (`findOffer`); the browser only names the rate.
  - The net is what the agency would pay Expedia; it is never recomputed (BP5). Prices change: before
    booking from a quote, the rate is searched and checked again (plan 5d).
- **The selling price is the agency's own price to its client**, not an Apolles markup.
  - Apolles still charges the agency the Expedia total (markup 0%, spec section 4).
  - Markup per quote: a percentage of the net (stored in basis points) or a fixed USD amount per room
    (stored in cents). Default 0%.
  - A price the agent typed on a room wins over the markup.
  - Money stays in integer cents, rounded half up once.
- **The client sees free cancellation until** a date the agent may set earlier than the supplier's date,
  never later.
- **Adding from a search**: the hotel page gets "Add to quote" next to "Book room".
  - The agent picks one of the agency's open quotes, or "New quote".
  - The quote's destination is found by destination and dates, or created.
  - The search's guests must match the quote's guests. A quote with no rooms yet takes the search's guests.
  - The same rate twice in one hotel is added once.
- **"+ Add hotel" on a destination** opens Search filled with that destination, dates and guests, and
  remembers the quote, so the hotel page offers "Add to Q-1048".
- **Statuses**: Draft, Sent, Viewed, Option selected, Booked. Only Draft is reachable in this plan.
- **Left out** (single agent per agency in phase 1): the "someone else saved this quote" warning.
- **Header**: Quotes becomes a menu (All quotes, New quote, Clients). On Clients: the Quotes column and
  "New quote" for that client.

## Data

`Quote`, `QuoteStay`, `QuoteHotel`, `QuoteRoom`. Every query is scoped by `agencyId`, and child rows go
through their quote. Indexes match each list and order: `(agencyId, updatedAt desc, id desc)`,
`(agencyId, status, updatedAt desc)`, `(quoteId, position)`, `(stayId, position)`, `(hotelId, position)`.
Quote number: one sequence, shown as `Q-` and the number.

## Tasks (each: failing test → code → green)

1. Schema and migration.
2. `src/server/quotes/pricing.ts`: selling price, profit, client cancellation date (pure functions).
3. `src/server/quotes/quotes.ts`: create, list (tabs, search, paging), get, update settings, stays
   (add, remove), hotels (move, pick, remove), rooms (price, client date, remove), add from a search.
   All scoped and audited, with no personal data in the audit log.
4. Screen 14 `/quotes` and screen 15 `/quotes/[id]`.
5. Hotel page "Add to quote"; Search prefill and the quote it adds to.
6. Header menu; Clients: Quotes column and "New quote".
7. Verify (typecheck, lint, tests, build, screenshots 1440 and 390), review, PR.
