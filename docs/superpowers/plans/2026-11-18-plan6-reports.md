# Plan 6: Selling price per booking and Reports (screens 11, 12, 13, 19)

Owner decision 2026-11-17 (`docs/decisions/2026-11-17-build-all-mockup-screens.md`). Mockups:
`11-review-and-book.html` ("Add your selling price (optional)"), `12-booking-summary.html` ("Your
selling price", profit), `13-bookings.html` ("Paid · profit USD …"), `19-reports.html`.

## Decisions (Claude)

- **The selling price is the agency's own number, for its reports only.** It never changes what
  Apolles charges (the supplier's total, from the price check) and is never on the voucher.
  - Stored on the booking: `sellMarkupType` + `sellMarkupValue` (as on quotes: percent in basis
    points, fixed in cents) or empty. The selling price and profit are computed from the charged
    total with the same rounding as quotes (`sellingMinor`), so they follow a price change.
  - Set on the review page (optional), changed later on the booking summary. A booking from a quote
    takes the quote's markup, or the room's typed price as a fixed difference.
  - Cancelled: sale and profit count as 0 (the refund comes back; a cancellation charge is a cost).
- **Reports (screen 19)**, for the agency only, by booking date, in USD:
  - Periods: This month, Last 7 days, Last month, This year, Custom range (max 366 days).
  - Gross sales (sum of selling prices; bookings without one count their net), Paid from balance
    (net of confirmed bookings), Your profit and average margin, "N bookings without a selling
    price" (link to Bookings), bookings by status, the change against the previous period.
  - Sales and profit by week (bars, plain SVG, no new package), key metrics (average value, average
    profit, average margin, cancellation rate).
  - Balance activity: current balance, top-ups and refunds in the period, the latest ledger rows,
    "View all activity" (/balance).
  - Top destinations and top hotels (by sales, top 5), recent bookings (latest 5).
  - Export CSV of the period's bookings (sale, net, profit, status).
  - All sums in SQL (`GROUP BY`), one query per block, indexed by `(agencyId, createdAt)`.
- **Left out**: "card top-up" rows (no cards, owner 17.11.2026), voucher states that do not exist
  in phase 1 (all confirmed bookings have a voucher).
- **Header**: Reporting becomes a menu (Overview, Balance history) instead of "Coming soon".
