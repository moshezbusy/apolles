# Plan 8g: "Email to client" on the booking summary (mockups 12, 23 #12)

The agent sends the client the hotel voucher by email, in the agency's name. Mockup 23 #12:
subject "Your hotel booking: (hotel), (dates)"; hotel, dates, guests, booking reference,
check-in details and fees payable at the hotel; no prices; the voucher PDF attached; only for a
booking with a voucher; the agent can edit the address; the quote language (English or Hebrew).

## Decisions (Claude)
- Only for the agency's own **confirmed** booking (the voucher exists only then). Agency-scoped,
  session checked (`requireAgent`), Zod strict input: the booking id and one email address.
- The address box starts with the quote's client email when the booking came from a quote with a
  client, else empty. The agent can change it. One address per send.
- The body has no prices at all (not the net price, not the selling price). It holds what the
  voucher holds for the guest: hotel and address, dates, check-in and check-out times, room, the
  guests, Apolles reference and hotel confirmation number, and "fees to pay at the property"
  (the supplier's amounts, as on the voucher). No supplier name, no Apolles brand.
- From the agency's name; Reply-To the agency's email (as the quote email, plan 5c).
- Language: the quote's language when the booking came from a quote, else English. The voucher
  PDF stays in English (the hotel reads it).
- Limits: 30 client emails an hour per agency (separate from quote emails) and 5 per booking a
  day. Over a limit: a calm "Try again later".
- Audit row `booking.email-client` with no address and no guest names. A send failure is logged
  by error name only.
- The email port gets attachments (`name`, `contentType`, `content` bytes). Postmark sends them
  base64; the console sink and the staging log record only the file names, never the bytes.

## Tests first
- Sends to the typed address with the voucher attached, in the agency's name; no price in the
  body; Hebrew body for a Hebrew quote.
- Refused: another agency's booking, a booking not confirmed, a bad address, unknown fields, over
  a limit. The audit row holds no address.
- Postmark: attachments are base64 with name and type. Console: names only.
