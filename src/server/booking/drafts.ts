import { db } from "@/server/db";
import { BookingInputInvalid, BookingNotFound, SPECIAL_REQUESTS, draftInputSchema, requestHasPersonalDetails, roomsOf, specialRequestText } from "./service";

// "Edit guest details" on the review page (screen 11): the guest names, the lead guest's contact
// and the special requests of the agency's own draft are changed in place. The rate, its price
// check and the rooms stay as they are (nothing about the price depends on the names), so no
// second draft is made and nothing has to be searched again. Only a draft can change; one that is
// being booked or was booked is refused. The change and a row in the booking's trail are written
// together.

const guestInput = draftInputSchema.pick({ rooms: true, leadEmail: true, leadPhone: true, specialRequests: true });
const REQUEST_MAX = 300; // as createDraft (service.ts)

export async function updateDraftGuests(ctx: { agencyId: string; userId: string }, bookingId: string, rawInput: unknown): Promise<void> {
  if (typeof bookingId !== "string" || bookingId.length > 64) throw new BookingNotFound();
  const booking = await db.booking.findFirst({ where: { id: bookingId, agencyId: ctx.agencyId } });
  if (!booking || booking.status !== "DRAFT") throw new BookingNotFound();
  const parsed = guestInput.safeParse(rawInput);
  if (!parsed.success) throw new BookingInputInvalid("Check the guest names, email and phone.", parsed.error.issues.map((issue) => issue.path.join(".")));
  const input = parsed.data;
  const specialRequest = specialRequestText(input.specialRequests);
  if (requestHasPersonalDetails(specialRequest)) {
    throw new BookingInputInvalid("Special requests go to the hotel: write no ID, card or phone numbers or email addresses there.");
  }
  if (specialRequest.length > REQUEST_MAX) throw new BookingInputInvalid(`Special requests can be up to ${REQUEST_MAX} characters in all. Shorten the additional request.`);
  const rooms = await roomsOf(booking);
  if (rooms.length === 0 || input.rooms.length !== rooms.length || input.rooms.some((room, i) => room.guests.length !== rooms[i]!.adults + rooms[i]!.childAges.length)) {
    throw new BookingInputInvalid("Enter a name for every guest.");
  }
  const guests = input.rooms.flatMap((room) => room.guests);
  const lead = guests[0]!;
  await db.$transaction(async (tx) => {
    const changed = await tx.booking.updateMany({
      where: { id: booking.id, agencyId: ctx.agencyId, status: "DRAFT" },
      data: {
        guests,
        leadGivenName: lead.givenName,
        leadFamilyName: lead.familyName,
        leadEmail: input.leadEmail,
        leadPhone: `+${input.leadPhone.countryCode} ${input.leadPhone.number}`,
        specialRequest,
      },
    });
    if (changed.count === 0) throw new BookingNotFound(); // booked in the meantime: nothing changed
    for (const [index, room] of input.rooms.entries()) {
      await tx.bookingRoom.update({
        where: { bookingId_index: { bookingId: booking.id, index } },
        data: { guests: room.guests, givenName: room.guests[0]!.givenName, familyName: room.guests[0]!.familyName },
      });
    }
    await tx.bookingEvent.create({ data: { bookingId: booking.id, fromStatus: "DRAFT", toStatus: "DRAFT", actorUserId: ctx.userId, reason: "Guest details changed" } });
  });
}

type StoredGuest = { givenName?: unknown; familyName?: unknown; title?: unknown };

// The guest form's fields filled from the agency's own draft (for "Edit guest details"): the
// names room by room, the contact, and the special requests read back from their stored text.
// null: not a draft of this agency.
export async function draftGuestValues(agencyId: string, bookingId: string): Promise<Record<string, string> | null> {
  if (typeof bookingId !== "string" || bookingId.length > 64) return null;
  const booking = await db.booking.findFirst({ where: { id: bookingId, agencyId, status: "DRAFT" } });
  if (!booking) return null;
  const rooms = await roomsOf(booking);
  const values: Record<string, string> = { leadEmail: booking.leadEmail };
  const phone = /^\+(\d{1,3}) (\d{4,14})$/.exec(booking.leadPhone);
  values.phoneCountry = phone?.[1] ?? "";
  values.phoneNumber = phone?.[2] ?? "";
  rooms.forEach((room, r) => {
    (Array.isArray(room.guests) ? (room.guests as StoredGuest[]) : []).forEach((g, i) => {
      values[`r${r}_given_${i}`] = typeof g.givenName === "string" ? g.givenName : "";
      values[`r${r}_family_${i}`] = typeof g.familyName === "string" ? g.familyName : "";
      values[`r${r}_title_${i}`] = typeof g.title === "string" ? g.title : "";
    });
  });
  // "Early check-in. High floor. Quiet room": the ticked requests first, then the agent's own text.
  let rest = booking.specialRequest.trim();
  const ticked: string[] = [];
  for (let found = true; found; ) {
    found = false;
    for (const [id, text] of Object.entries(SPECIAL_REQUESTS)) {
      if (rest.startsWith(`${text}.`) && !ticked.includes(id)) {
        ticked.push(id);
        rest = rest.slice(text.length + 1).trim();
        found = true;
      }
    }
  }
  values.requests = ticked.join(",");
  values.requestText = rest;
  return values;
}
