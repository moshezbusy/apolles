import type { BookingStatus, Prisma } from "@/generated/prisma/client";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { SearchError } from "@/server/search/errors";
import { type SearchContext, searchOneHotel, snapshotOffers } from "@/server/search/search";
import type { Offer, SupplierAdapter } from "@/server/supplier/types";
import type { Markup } from "./pricing";

// Plan 5d: booking the client's choice from a quote. The quote never sets the price: the hotel is
// searched again and the normal booking pages check the rate with the supplier, as for any booking.

// A booking that holds or may hold the room: a destination with one of these is booked.
export const ACTIVE_BOOKING: BookingStatus[] = ["PENDING_CONFIRMATION", "CONFIRMED", "CANCEL_PENDING"];

export type QuoteBookingRate = { s: string; p: string; r: string; b: string };
export type PrepareResult = { ok: true; rate: QuoteBookingRate } | { ok: false; error: string };

const fail = (error: string) => ({ ok: false, error }) as const;

// "Book this room": the stay's picked room, found again in a fresh search of its hotel for the
// stay's destination, dates and the quote's guests. Same rate and bed type if the supplier still
// has them; else the same room, refund terms and bed type. The browser only names the stay.
export async function prepareQuoteBooking(
  ctx: SearchContext,
  stayId: string,
  deps: { adapter?: SupplierAdapter; now?: Date } = {},
): Promise<PrepareResult> {
  const now = deps.now ?? new Date();
  if (typeof stayId !== "string" || stayId.length > 64) return fail("This quote was not found.");
  const stay = await db.quoteStay.findFirst({
    where: { id: stayId, quote: { agencyId: ctx.agencyId } },
    select: {
      id: true,
      destinationId: true,
      checkin: true,
      checkout: true,
      quote: { select: { status: true, adults: true, childAges: true } },
      selectedRoom: { select: { roomId: true, rateId: true, bedGroupId: true, refundable: true, bedDescription: true, hotel: { select: { propertyId: true } } } },
    },
  });
  if (!stay) return fail("This quote was not found.");
  if (stay.quote.status === "BOOKED") return fail("This quote is already booked.");
  const room = stay.selectedRoom;
  if (!room) return fail("The client has not chosen a room here yet.");
  const active = await db.booking.findFirst({ where: { agencyId: ctx.agencyId, quoteStayId: stay.id, status: { in: ACTIVE_BOOKING } }, select: { id: true } });
  if (active) return fail("This destination is already booked.");

  const propertyId = room.hotel.propertyId;
  let snapshotId: string;
  try {
    ({ snapshotId } = await searchOneHotel(
      ctx,
      { destinationId: stay.destinationId, propertyId, checkin: stay.checkin, checkout: stay.checkout, rooms: [{ adults: stay.quote.adults, childAges: stay.quote.childAges }] }, // quotes are one room
      deps,
    ));
  } catch (error) {
    if (error instanceof SearchError) return fail(error.message);
    throw error;
  }
  const found = matchRate(await snapshotOffers(ctx.agencyId, snapshotId, propertyId, now), room);
  if (!found) return fail("This room is no longer available at this hotel for these dates. Search the hotel again for other rooms.");
  return { ok: true, rate: { s: snapshotId, p: propertyId, r: found.offer.rateId, b: found.bedGroupId } };
}

function matchRate(
  offers: Offer[],
  room: { roomId: string; rateId: string; bedGroupId: string; refundable: boolean; bedDescription: string },
): { offer: Offer; bedGroupId: string } | null {
  const same = offers.find((o) => o.rateId === room.rateId && o.bedGroups.some((b) => b.id === room.bedGroupId));
  if (same) return { offer: same, bedGroupId: room.bedGroupId };
  for (const offer of offers) {
    if (offer.roomId !== room.roomId || offer.refundable !== room.refundable) continue;
    const bed = offer.bedGroups.find((b) => b.description === room.bedDescription);
    if (bed) return { offer, bedGroupId: bed.id };
  }
  return null;
}

// For createDraft: the agency's own stay, of a quote not yet booked, whose picked hotel, dates and
// guests are the ones of the rate.
export async function stayForDraft(
  agencyId: string,
  stayId: string,
  rate: { propertyId: string; checkin: string; checkout: string; adults: number; childAges: number[] },
): Promise<{ quoteId: string; quoteStayId: string; sellMarkup: Markup | null } | "not_found" | "mismatch"> {
  const stay = await db.quoteStay.findFirst({
    where: { id: stayId, quote: { agencyId, status: { not: "BOOKED" } } },
    select: {
      id: true,
      quoteId: true,
      checkin: true,
      checkout: true,
      quote: { select: { adults: true, childAges: true, markupType: true, markupValue: true } },
      selectedRoom: { select: { netMinor: true, sellMinor: true, hotel: { select: { propertyId: true } } } },
    },
  });
  if (!stay) return "not_found";
  // Only the hotel the client picked on this destination, for its dates and the quote's guests.
  const same =
    stay.checkin === rate.checkin &&
    stay.checkout === rate.checkout &&
    stay.quote.adults === rate.adults &&
    stay.quote.childAges.join(",") === rate.childAges.join(",") &&
    stay.selectedRoom?.hotel.propertyId === rate.propertyId;
  if (!same || !stay.selectedRoom) return "mismatch";
  // The booking keeps the client's selling price as a markup (plan 6, reports only): a price the
  // agent typed on the room becomes the same fixed difference (below the net: a loss, kept as
  // is); else the quote's markup. A 0 markup with no typed price is "no selling price".
  const room = stay.selectedRoom;
  const sellMarkup: Markup | null =
    room.sellMinor !== null
      ? { markupType: "FIXED", markupValue: room.sellMinor - room.netMinor }
      : stay.quote.markupValue > 0
        ? { markupType: stay.quote.markupType, markupValue: stay.quote.markupValue }
        : null;
  return { quoteId: stay.quoteId, quoteStayId: stay.id, sellMarkup };
}

export class QuoteStayAlreadyBooked extends Error {
  constructor() {
    super("This destination of the quote is already booked. Open the quote to see the booking.");
    this.name = "QuoteStayAlreadyBooked";
  }
}

export class QuoteStayChanged extends Error {
  constructor() {
    super("The client's choice on this quote changed. Open the quote and choose Book again.");
    this.name = "QuoteStayChanged";
  }
}

// Inside the transaction that places the hold. Locks the quote, then the destination (the same
// order as the editor, the client's choice, confirm and cancel), then checks under the lock that
// the booking is still the client's pick: the destination is there, the quote is not booked, the
// picked hotel and dates are the booking's, and no other booking holds it.
export async function claimQuoteStay(tx: Prisma.TransactionClient, bookingId: string): Promise<void> {
  const booking = await tx.booking.findUniqueOrThrow({
    where: { id: bookingId },
    select: { quoteId: true, quoteStayId: true, agencyId: true, propertyId: true, checkin: true, checkout: true },
  });
  if (!booking.quoteId) return;
  await tx.$queryRaw`SELECT id FROM "Quote" WHERE id = ${booking.quoteId} FOR UPDATE`;
  // Read again after the lock: a removed destination clears the booking's link.
  const linked = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { quoteStayId: true } });
  if (!linked.quoteStayId) throw new QuoteStayChanged();
  await tx.$queryRaw`SELECT id FROM "QuoteStay" WHERE id = ${linked.quoteStayId} FOR UPDATE`;
  const stay = await tx.quoteStay.findFirst({
    where: { id: linked.quoteStayId, quote: { id: booking.quoteId, agencyId: booking.agencyId } },
    select: { checkin: true, checkout: true, quote: { select: { status: true } }, selectedRoom: { select: { hotel: { select: { propertyId: true } } } } },
  });
  if (
    !stay ||
    stay.quote.status === "BOOKED" ||
    stay.checkin !== booking.checkin ||
    stay.checkout !== booking.checkout ||
    stay.selectedRoom?.hotel.propertyId !== booking.propertyId
  ) {
    throw new QuoteStayChanged();
  }
  const other = await tx.booking.count({ where: { quoteStayId: linked.quoteStayId, status: { in: ACTIVE_BOOKING }, id: { not: bookingId } } });
  if (other > 0) throw new QuoteStayAlreadyBooked();
}

// The quote row of a booking, locked first in every booking transaction that may change the quote
// (confirm, cancel), in the same order as the quote editor (quote, then its rows): no deadlock.
export async function lockQuoteOfBooking(tx: Prisma.TransactionClient, bookingId: string): Promise<void> {
  const booking = await tx.booking.findUnique({ where: { id: bookingId }, select: { quoteId: true } });
  if (booking?.quoteId) await tx.$queryRaw`SELECT id FROM "Quote" WHERE id = ${booking.quoteId} FOR UPDATE`;
}

// After a booking from a quote changes (confirmed, cancelled): the quote's status follows.
export async function syncQuoteOfBooking(tx: Prisma.TransactionClient, bookingId: string): Promise<void> {
  const booking = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { quoteId: true, agencyId: true, userId: true } });
  if (booking.quoteId) await syncQuoteBooked(tx, booking.quoteId, booking.agencyId, booking.userId, bookingId);
}

// The quote is Booked once every destination with a client pick has a confirmed booking, and goes
// back to Selected if one of those bookings is cancelled (so it can be booked again). Call with the
// quote row locked.
export async function syncQuoteBooked(tx: Prisma.TransactionClient, quoteId: string, agencyId: string, actorUserId: string, bookingId?: string): Promise<void> {
  const quote = await tx.quote.findFirst({ where: { id: quoteId, agencyId }, select: { status: true } });
  if (!quote) return;
  const stays = await tx.quoteStay.findMany({
    where: { quoteId, selectedRoomId: { not: null } },
    select: { id: true, bookings: { where: { agencyId, status: "CONFIRMED" }, select: { id: true }, take: 1 } },
  });
  const allBooked = stays.length > 0 && stays.every((s) => s.bookings.length > 0);
  if (allBooked && quote.status !== "BOOKED") {
    await tx.quote.update({ where: { id: quoteId }, data: { status: "BOOKED" } });
    await audit(actorUserId, "quote.booked", "Quote", quoteId, undefined, bookingId ? { bookingId } : undefined, tx);
  } else if (!allBooked && quote.status === "BOOKED") {
    await tx.quote.update({ where: { id: quoteId }, data: { status: stays.length > 0 ? "SELECTED" : "VIEWED" } });
    await audit(actorUserId, "quote.reopened", "Quote", quoteId, undefined, bookingId ? { bookingId } : undefined, tx);
  }
}

// A destination with a booking that holds or may hold the room cannot change (pick, rooms, hotels)
// until that booking is cancelled or failed.
export async function stayHasActiveBooking(tx: Prisma.TransactionClient, stayId: string): Promise<boolean> {
  return (await tx.booking.count({ where: { quoteStayId: stayId, status: { in: ACTIVE_BOOKING } } })) > 0;
}

export const STAY_BOOKED = "This destination has a booking. Cancel the booking first to change it.";

export type StayBooking = { id: string; reference: string; status: BookingStatus; hotelName: string; confirmedAt: Date | null };

// The active booking of each destination of the agency's quote (editor and list).
export async function stayBookings(agencyId: string, quoteId: string): Promise<Map<string, StayBooking>> {
  const rows = await db.booking.findMany({
    where: { agencyId, quoteId, quoteStayId: { not: null }, status: { in: ACTIVE_BOOKING } },
    orderBy: { createdAt: "desc" },
    select: { id: true, reference: true, status: true, hotelName: true, confirmedAt: true, quoteStayId: true },
  });
  const map = new Map<string, StayBooking>();
  for (const { quoteStayId, ...b } of rows) if (quoteStayId && !map.has(quoteStayId)) map.set(quoteStayId, b);
  return map;
}

export type GuestPrefill = {
  clientId: string;
  guests: { givenName: string; familyName: string }[];
  leadEmail: string;
  phoneCountry: string;
  phoneNumber: string;
};

// Guest details filled from a client of the agency: the client is the lead guest, the companions
// the other guests. From a quote's stay: its client.
export async function bookingPrefill(agencyId: string, from: { stayId?: string; clientId?: string }): Promise<GuestPrefill | null> {
  let clientId = from.clientId;
  if (from.stayId) {
    if (from.stayId.length > 64) return null;
    const stay = await db.quoteStay.findFirst({ where: { id: from.stayId, quote: { agencyId } }, select: { quote: { select: { clientId: true } } } });
    clientId = stay?.quote.clientId ?? undefined;
  }
  if (!clientId || clientId.length > 64) return null;
  const client = await db.client.findFirst({
    where: { id: clientId, agencyId },
    select: { id: true, firstName: true, lastName: true, email: true, phone: true, companions: { orderBy: { createdAt: "asc" }, select: { firstName: true, lastName: true } } },
  });
  if (!client) return null;
  const phone = splitPhone(client.phone);
  return {
    clientId: client.id,
    guests: [{ givenName: client.firstName, familyName: client.lastName }, ...client.companions.map((c) => ({ givenName: c.firstName, familyName: c.lastName }))],
    leadEmail: client.email ?? "",
    ...phone,
  };
}

// "+972 50 123 4567" → 972 and 501234567. Without a clear country code, the agent types it.
function splitPhone(phone: string): { phoneCountry: string; phoneNumber: string } {
  const match = /^\s*(?:\+|00)(\d{1,3})[\s-]+(.*)$/.exec(phone);
  if (match) return { phoneCountry: match[1] ?? "", phoneNumber: (match[2] ?? "").replace(/\D/g, "").replace(/^0/, "") };
  return { phoneCountry: "", phoneNumber: phone.replace(/\D/g, "") };
}
