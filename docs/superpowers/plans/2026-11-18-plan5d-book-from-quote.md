# Plan 5d (part 1): Book the client's selection from a quote (screens 10, 14, 15)

Owner decision 2026-11-17 (`docs/decisions/2026-11-17-build-all-mockup-screens.md`). Mockups:
`14-quotes.html` ("Book selected option", "View booking", "Booked Sep 11 · hotel · reference"),
`10-guest-details.html` ("Choose from clients", "Save the lead guest to Clients"). Part 2 of plan 5d is
the settings tabs (screen 20).

## Decisions (Claude)

- **What is booked**: the room the client chose on each destination (stay). One booking per stay,
  as a normal booking (spec section 3: one room per booking in phase 1). A quote with three
  destinations is three bookings.
- **The price is never taken from the quote.** "Book this room" searches the quoted hotel again for
  the stay's destination, dates and the quote's guests (`searchOneHotel`, same rate limit as a
  search), then opens the normal guest details page for that new rate. The review page checks the
  price with the supplier again, as for every booking. Apolles charges the net (Expedia total),
  never the client's selling price.
  - The new rate is found by the same rate and bed type ids; if the supplier changed the ids, by the
    same room, same refundable, same bed description. Otherwise: "no longer available".
- **Link**: `Booking.quoteId` and `Booking.quoteStayId` (both `SET NULL` if the quote goes). The server
  checks the stay is the agency's own, its quote is not booked, the rate's hotel is one of the
  stay's hotels and the dates are the stay's dates. The browser only sends the stay id.
- **No double booking of a stay**: in the same transaction that places the hold, the stay row is
  locked and any other active booking of it (pending, confirmed, cancel pending) stops this one.
- **Quote status**: when a booking from a quote is confirmed (also by reconcile), the quote becomes
  Booked once every destination with a client pick has a confirmed booking. Same transaction as the
  confirmation, with an audit row.
- **Guest details from the quote**: the lead guest is filled from the quote's client, the other
  guests from the client's companions. "Choose from clients" fills them from any client of the
  agency. "Save the lead guest to Clients" makes a new client (only when no client was chosen).
- **Screens**: the editor's "Client selections" gets "Book this room" per picked destination, or
  "Booked · reference" with a link. The list's Selected card gets "Book selected option" (opens the
  editor's selections); a Booked card gets "View booking" and "Booked <date> · hotel · reference".

## Tests first

- searchOneHotel: input checks, one candidate, rate limit.
- bookFromQuote: another agency's stay, no pick, booked quote, rate gone, ids changed (fallback),
  redirect to guest details with the stay.
- createDraft with quoteStayId: wrong agency, wrong hotel, wrong dates, booked quote.
- book: a second booking of the same stay is refused; confirm marks the quote booked only when all
  picked stays are booked; reconcile path too.
- Guest page: prefilled from the client and companions; "Save to Clients".
- List and editor render the new buttons.

## After review (independent agent)

- **A booked destination is frozen**: while it has a pending or confirmed booking, the client
  cannot change its pick and the agent cannot remove its rooms, hotels or the destination.
  The client page shows "Booked" on it.
- **Cancelling reopens**: when a booking from a quote is cancelled, the quote goes back to
  Selected (audit "quote.reopened") and the destination can be booked again. The quote row is
  locked first in the confirm and cancel transactions (same order as the editor).
- **The quote follows its picks**: after the client's choice or a removal, if every remaining pick
  is booked, the quote becomes Booked.
- **A draft from a quote must be the picked hotel**, not any hotel of the destination.
- "New guest" on the guest page clears the quote client's details (`client=none`). "Save the lead
  guest to Clients" does not make a second card for the same name and phone, and never stops the
  booking.

# Plan 5d (part 2): Agency settings tabs (screen 20)

- Tabs as links (`/settings?tab=`): Agency profile (as before), Quote branding, Preferences,
  Balance & top-ups, Account.
- **Quote branding**: display name, advisor name, contact number (WhatsApp and Call buttons),
  advisor email (replies to the quote email), default language, brand color, default message.
  Empty = the agency's own name, phone and the agent's name. The color is stored only as `#rrggbb`
  and checked again before it reaches the client page's style. A live preview shows the result.
- **Preferences**: default markup (percent or fixed USD per room) and "Show cancellation terms".
  Every new quote starts with these, the default language and the default message.
- **Balance & top-ups**: the balance, a link to the activity, the bank details and the agency's
  reference. No card top-up (owner, 17.11.2026: no card details anywhere).
- **Account**: name, login email, "Change password" (emails a link to set a new one, with the same
  limits as "Forgot password"; no new password code), Sign out.
- **Left out** (not in the approved spec): the pay-later limit (not phase 1), ILS prices on client
  quotes (USD only, owner 17.11.2026), business address and website fields.
