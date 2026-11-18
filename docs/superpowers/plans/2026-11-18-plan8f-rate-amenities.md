# Plan 8f: what the rate includes (meal plan) — mockups 08, 09, 10–13, 15–17, 21

The mockups show a "Board" line (e.g. "Breakfast included"). Rapid gives each rate an `amenities`
map (`{ id, name, value? }`); meal plans (breakfast, half board, all inclusive) come there, mixed
with other rate perks (free WiFi, parking). We have no list of which ids are meals that we could
check, so we do not guess: we show the rate's amenity names exactly as the supplier gives them,
under "Rate includes" (EXP: supplier text, unchanged). No amenity → no line (never "Room only",
which we cannot know).

## Decisions (Claude)
- Adapter: `Offer.amenities: string[]`, the names from `rate.amenities` (values ignored), trimmed,
  control characters removed, each at most 100 characters, at most 10, duplicates dropped. A bad
  or missing map gives `[]`, never a dropped rate.
- Stored searches: an older snapshot without the field reads as `[]`.
- Copied where the room is copied: `QuoteRoom.amenities` and `Booking.amenities` (`String[]`,
  default empty; migration only adds the columns).
- Shown: results card, hotel page rate row, guest details and review (the offer), booking summary,
  voucher (client document: the hotel's own perks are fine to show), quote editor and the client
  quote page. Plain text only.
- Not done: translating the names (the Hebrew client page shows them as the supplier wrote them).

## Tests first
- Adapter: names read from the fixture's `amenities`; a malformed map gives `[]` and the rate stays.
- Search snapshot round trip; old snapshot without `amenities` still reads.
- Booking draft and quote room copy the names; the voucher and the client quote page show them.
