# Apolles design: the owner's mockups

`mockups/` holds the owner's 24 designed screens (`Apolles-Mockups.zip`, sent by Moshe in chat).
They are the visual source for every Apolles screen. Open `mockups/index.html` in a browser to see them all.

**Read this before any UI work.** If a screen you are building has a mockup here, it must look like it.

| # | Screen | File |
|---|---|---|
| 01 | Home page | `pages/01-homepage.html` |
| 02 | Join | `pages/02-join.html` |
| 03 | Application received | `pages/03-application-received.html` |
| 04 | Sign in | `pages/04-login.html` |
| 05 | Forgot password | `pages/05-forgot-password.html` |
| 06 | Set password | `pages/06-set-password.html` |
| 07 | Search | `pages/07-search.html` |
| 08 | Search results | `pages/08-search-results.html` |
| 09 | Hotel and rooms | `pages/09-hotel-rooms.html` |
| 10 | Guest details | `pages/10-guest-details.html` |
| 11 | Review and book | `pages/11-review-and-book.html` |
| 12 | Booking summary | `pages/12-booking-summary.html` |
| 13 | Bookings | `pages/13-bookings.html` |
| 14 | Quotes | `pages/14-quotes.html` |
| 15 | Quote editor | `pages/15-quote-editor.html` |
| 16 | Client quote (English) | `pages/16-client-quote-en.html` |
| 17 | Client quote (Hebrew) | `pages/17-client-quote-he.html` |
| 18 | Clients | `pages/18-clients.html` |
| 19 | Reports | `pages/19-reports.html` |
| 20 | Agency settings | `pages/20-agency-settings.html` |
| 21 | Voucher | `pages/21-voucher.html` |
| 22 | Invoice | `pages/22-invoice.html` |
| 23 | Emails | `pages/23-emails.html` |
| 24 | System states | `pages/24-system-states.html` |

Rules that still win over a mockup: Expedia's requirements, then the approved spec
(`docs/specs/approved/`), then the mockups. For example, the supplier's name or logo is never shown (GR1),
and no card data is ever taken. A "Mockup demo only" box in a mockup is not part of the screen.

Owner decision about which screens to build: `docs/decisions/2026-11-17-build-all-mockup-screens.md`.
