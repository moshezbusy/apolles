// Guests as stored on a booking room: adults first (the room's main guest is its first adult),
// then the children, each with the age the search was priced for (BP7). A title (plan 8b) comes
// first. The booking itself keeps every room's guests one room after another, in room order
// (plan 10): a one-room booking reads the same as before; with several rooms, read each room's
// own guests (roomGuestLines), since adults and children are counted per room.
export type StoredGuest = { givenName: string; familyName: string; title?: "MR" | "MRS" | "MS" };

const TITLE = { MR: "Mr", MRS: "Mrs", MS: "Ms" } as const;

export function guestName(g: StoredGuest): string {
  return `${g.title ? `${TITLE[g.title]} ` : ""}${g.givenName} ${g.familyName}`;
}

export function guestLines(guests: StoredGuest[], adults: number, childAges: number[]): string[] {
  return guests.map((g, i) => (i < adults ? guestName(g) : `${guestName(g)} (child, age ${childAges[i - adults] ?? "?"})`));
}

type StoredRoom = { adults: number; childAges: number[]; guests: unknown };

export function roomGuestLines(room: StoredRoom): string[] {
  return guestLines(room.guests as StoredGuest[], room.adults, room.childAges);
}

// "Room 2 · 2 adults, 1 child" (index is 0-based, as stored).
export function roomTitle(index: number, room: { adults: number; childAges: number[] }): string {
  const children = room.childAges.length;
  const guests = [`${room.adults} ${room.adults === 1 ? "adult" : "adults"}`];
  if (children > 0) guests.push(`${children} ${children === 1 ? "child" : "children"}`);
  return `Room ${index + 1} · ${guests.join(", ")}`;
}

// "Room 2 · 1 adult, 1 child (7)": the title with the children's ages, for a booked room on the
// booking's pages and documents.
export function roomHeading(index: number, room: { adults: number; childAges: number[] }): string {
  const title = roomTitle(index, room);
  return room.childAges.length > 0 ? `${title} (${room.childAges.join(", ")})` : title;
}

// The one hotel confirmation of a one-room booking: the booking's own (set when a reconcile
// confirmed it, and on bookings made before plan 10), else its room's (filled after booking).
export function oneRoomConfirmation(booking: { hotelConfirmationId: string | null }, rooms: { hotelConfirmationId: string | null }[]): string | null {
  return booking.hotelConfirmationId ?? rooms[0]?.hotelConfirmationId ?? null;
}
