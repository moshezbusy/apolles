import type { Booking, BookingStatus, Prisma } from "@/generated/prisma/client";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { SearchError } from "@/server/search/errors";
import { type SearchContext, searchOneHotel, snapshotOffers } from "@/server/search/search";
import type { CancelPenalty, Offer, SupplierAdapter } from "@/server/supplier/types";
import { type Markup, clientCancelView, dayAhead, lastFreeDay, sellingMinor, todayIso } from "./pricing";

// Plan 5d: booking the client's choice from a quote. The quote never sets the price: the hotel is
// searched again and the normal booking pages check the rate with the supplier, as for any booking.

// A booking that holds or may hold the room: a destination with one of these is booked.
export const ACTIVE_BOOKING: BookingStatus[] = ["PENDING_CONFIRMATION", "CONFIRMED", "CANCEL_PENDING"];

export type QuoteBookingRate = { s: string; p: string; r: string; b: string };
// `rooms`: the picked rate is gone but the hotel still has rooms for these dates: the fresh
// search to choose another room from (the destination and the client's pick stay as they are).
export type PrepareResult = { ok: true; rate: QuoteBookingRate } | { ok: false; error: string; rooms?: { quoteId: string; snapshotId: string } };

const fail = (error: string) => ({ ok: false, error }) as const;

const NOT_FOUND = "This quote was not found.";
export const ROOM_GONE = "This room is no longer available at this hotel for these dates.";

// "Book this room": the stay's picked room, found again in a fresh search of its hotel for the
// stay's destination, dates and the quote's guests. Same rate and bed type if the supplier still
// has them; else the same room with the same refund terms, the same inclusions (board) and the
// same bed type. The browser only names the stay.
export async function prepareQuoteBooking(
  ctx: SearchContext,
  stayId: string,
  deps: { adapter?: SupplierAdapter; now?: Date } = {},
): Promise<PrepareResult> {
  const now = deps.now ?? new Date();
  if (typeof stayId !== "string" || stayId.length > 64) return fail(NOT_FOUND);
  const stay = await db.quoteStay.findFirst({
    where: { id: stayId, quote: { agencyId: ctx.agencyId } },
    select: {
      id: true,
      quoteId: true,
      destinationId: true,
      checkin: true,
      checkout: true,
      quote: { select: { status: true, closedAt: true, adults: true, childAges: true } },
      selectedRoom: {
        select: { roomId: true, rateId: true, bedGroupId: true, refundable: true, bedDescription: true, amenities: true, netMinor: true, hotel: { select: { propertyId: true } } },
      },
    },
  });
  if (!stay) return fail(NOT_FOUND);
  if (stay.quote.status === "BOOKED") return fail("This quote is already booked.");
  if (stay.quote.closedAt) return fail("This quote is closed. Choose Reopen quote to book from it.");
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
  const offers = await snapshotOffers(ctx.agencyId, snapshotId, propertyId, now);
  const found = matchRate(offers, room);
  if (found) return { ok: true, rate: { s: snapshotId, p: propertyId, r: found.offer.rateId, b: found.bedGroupId } };
  // The hotel has other rooms: the agent chooses one of them for this destination (any rate of
  // the picked hotel can be booked for it). Nothing at all: the quote stays as it is, to be
  // changed with the client or closed.
  if (offers.length > 0) return { ok: false, error: `${ROOM_GONE} Choose another room of this hotel below.`, rooms: { quoteId: stay.quoteId, snapshotId } };
  return fail(`${ROOM_GONE} This hotel has no rooms left for them. Ask the client to choose another hotel, or close the quote.`);
}

export type OtherRooms = {
  quoteId: string;
  number: number;
  stayId: string;
  destinationName: string;
  checkin: string;
  checkout: string;
  hotelName: string;
  propertyId: string;
  picked: { roomName: string; bedDescription: string; amenities: string[]; quotedMinor: number; currency: string };
  offers: Offer[];
};

// The page that follows "the picked room is gone": the rooms the picked hotel has now, from the
// agency's own fresh search, to book one of them for this destination. null when the destination
// is not the agency's, has no pick, is booked, or the search is another agency's or expired.
export async function otherRooms(agencyId: string, quoteId: string, stayId: string, snapshotId: string, now: Date = new Date()): Promise<OtherRooms | null> {
  for (const value of [quoteId, stayId, snapshotId]) if (typeof value !== "string" || value.length === 0 || value.length > 64) return null;
  const stay = await db.quoteStay.findFirst({
    where: { id: stayId, quoteId, quote: { agencyId, status: { not: "BOOKED" }, closedAt: null } },
    select: {
      id: true,
      destinationName: true,
      checkin: true,
      checkout: true,
      quote: { select: { id: true, number: true, agencyNumber: true, markupType: true, markupValue: true } },
      selectedRoom: { select: { roomName: true, bedDescription: true, amenities: true, netMinor: true, sellMinor: true, currency: true, hotel: { select: { propertyId: true, name: true } } } },
      bookings: { where: { agencyId, status: { in: ACTIVE_BOOKING } }, select: { id: true }, take: 1 },
    },
  });
  const room = stay?.selectedRoom;
  if (!stay || !room || stay.bookings.length > 0) return null;
  const offers = await snapshotOffers(agencyId, snapshotId, room.hotel.propertyId, now);
  if (offers.length === 0) return null;
  return {
    quoteId: stay.quote.id,
    number: stay.quote.agencyNumber ?? stay.quote.number,
    stayId: stay.id,
    destinationName: stay.destinationName,
    checkin: stay.checkin,
    checkout: stay.checkout,
    hotelName: room.hotel.name,
    propertyId: room.hotel.propertyId,
    picked: { roomName: room.roomName, bedDescription: room.bedDescription, amenities: room.amenities, quotedMinor: sellingMinor(room, stay.quote), currency: room.currency },
    offers: [...offers].sort((a, b) => a.price.total.minor - b.price.total.minor),
  };
}

type QuotedRate = { roomId: string; rateId: string; bedGroupId: string; refundable: boolean; bedDescription: string; amenities: string[]; netMinor: number };

function sameInclusions(a: string[], b: string[]): boolean {
  const left = [...new Set(a)].sort();
  const right = [...new Set(b)].sort();
  return left.length === right.length && left.every((value, i) => value === right[i]);
}

// The quoted rate in a fresh search. The supplier may give the same rate a new id: then only a
// rate of the same room with the same refund flag, exactly the same inclusions (breakfast, half
// board: the client was promised them) and the same bed type stands in for it, and of several,
// the one closest in price to what was quoted. Anything else is not the client's choice.
export function matchRate(offers: Offer[], room: QuotedRate): { offer: Offer; bedGroupId: string } | null {
  const same = offers.find((o) => o.rateId === room.rateId && o.bedGroups.some((b) => b.id === room.bedGroupId));
  if (same) return { offer: same, bedGroupId: room.bedGroupId };
  let best: { offer: Offer; bedGroupId: string } | null = null;
  for (const offer of offers) {
    if (offer.roomId !== room.roomId || offer.refundable !== room.refundable || !sameInclusions(offer.amenities, room.amenities)) continue;
    const bed = offer.bedGroups.find((b) => b.description === room.bedDescription);
    if (!bed) continue;
    const closer = !best || Math.abs(offer.price.total.minor - room.netMinor) < Math.abs(best.offer.price.total.minor - room.netMinor);
    if (closer) best = { offer, bedGroupId: bed.id };
  }
  return best;
}

// For createDraft: the agency's own stay, of a quote not yet booked and not closed, whose picked
// hotel, dates and guests are the ones of the rate.
export async function stayForDraft(
  agencyId: string,
  stayId: string,
  rate: { propertyId: string; checkin: string; checkout: string; adults: number; childAges: number[] },
): Promise<{ quoteId: string; quoteStayId: string; sellMinor: number | null } | "not_found" | "mismatch"> {
  const stay = await db.quoteStay.findFirst({
    where: { id: stayId, quote: { agencyId, status: { not: "BOOKED" }, closedAt: null } },
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
  return { quoteId: stay.quoteId, quoteStayId: stay.id, sellMinor: quotedSellMinor(stay.selectedRoom, stay.quote) };
}

// The price the client is quoted for a room, as an amount (plan 6, reports only): the price the
// agent typed on the room (below the net: a loss, kept as is), else the room's net when it was
// quoted plus the quote's markup. The booking keeps this amount, never a markup on the old net:
// the client pays it whatever the net is on the day of booking. A 0 markup with no typed price
// is "no selling price".
export function quotedSellMinor(room: { netMinor: number; sellMinor: number | null }, quote: Markup): number | null {
  if (room.sellMinor === null && quote.markupValue <= 0) return null;
  return sellingMinor(room, quote);
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

// The quote is Booked once EVERY destination that still has room options has a confirmed booking:
// a destination the client has not chosen yet keeps the quote open (the client can still choose
// there, the agent can still edit; the booked destinations are frozen one by one). It goes back to
// Selected if one of those bookings is cancelled (so it can be booked again). A trip that will not
// be completed is finished with "Close quote". Call with the quote row locked.
export async function syncQuoteBooked(tx: Prisma.TransactionClient, quoteId: string, agencyId: string, actorUserId: string, bookingId?: string): Promise<void> {
  const quote = await tx.quote.findFirst({ where: { id: quoteId, agencyId }, select: { status: true } });
  if (!quote) return;
  const stays = await tx.quoteStay.findMany({
    where: { quoteId },
    select: {
      selectedRoomId: true,
      hotels: { select: { _count: { select: { rooms: true } } } },
      bookings: { where: { agencyId, status: "CONFIRMED" }, select: { id: true }, take: 1 },
    },
  });
  const withRooms = stays.filter((s) => s.hotels.some((h) => h._count.rooms > 0));
  const allBooked = withRooms.length > 0 && withRooms.every((s) => s.bookings.length > 0);
  if (allBooked && quote.status !== "BOOKED") {
    await tx.quote.update({ where: { id: quoteId }, data: { status: "BOOKED" } });
    await audit(actorUserId, "quote.booked", "Quote", quoteId, undefined, bookingId ? { bookingId } : undefined, tx);
  } else if (!allBooked && quote.status === "BOOKED") {
    await tx.quote.update({ where: { id: quoteId }, data: { status: stays.some((s) => s.selectedRoomId) ? "SELECTED" : "VIEWED" } });
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

// ---------- the review page of a booking made from a quote ----------

// What the agent must see before paying for a booking that came from a quote: the quote never
// sets the price, so days later the net, and the cancellation terms, may not be what the client
// was quoted.
export type QuoteReview = {
  quoteId: string;
  number: number; // the agency's own quote number ("Q-n")
  currency: string;
  quotedMinor: number; // the price shown to the client for the room they picked
  priced: boolean; // false: a 0 markup and no typed price, so the client saw the net itself
  chosenAtMinor: number | null; // the price when the client chose, if it was another one
  netThenMinor: number; // the room's net when it was quoted
  netNowMinor: number; // the net just checked with the supplier
  profitThenMinor: number;
  profitNowMinor: number;
  clientFreeDay: string | null; // the free-cancellation date the client was shown (null: none shown)
  freeThenDay: string | null; // the supplier's last free day when it was quoted
  freeNowDay: string | null; // the supplier's last free day of the rate being booked, if still ahead
  rateChanged: boolean; // not the very rate that was quoted (another id, bed type or room)
  profitLower: boolean;
  termsWorse: boolean;
  // The agent must tick "I checked the new price and terms" before booking.
  needsCheck: boolean;
};

type ReviewedBooking = Pick<Booking, "agencyId" | "quoteStayId" | "totalMinor" | "currency" | "roomId" | "rateId" | "bedGroupId" | "refundable" | "cancelPenalties">;

// null: not from a quote (or the destination or the client's pick is gone: booking is refused
// anyway). Reads the agency's own quote only.
export async function quoteReview(agencyId: string, booking: ReviewedBooking, now: Date = new Date()): Promise<QuoteReview | null> {
  if (!booking.quoteStayId || booking.agencyId !== agencyId) return null;
  const stay = await db.quoteStay.findFirst({
    where: { id: booking.quoteStayId, quote: { agencyId } },
    select: {
      selectedSellMinor: true,
      quote: { select: { id: true, number: true, agencyNumber: true, markupType: true, markupValue: true, showCancellation: true } },
      selectedRoom: {
        select: { roomId: true, rateId: true, bedGroupId: true, refundable: true, freeCancelUntil: true, clientCancelUntil: true, netMinor: true, sellMinor: true, currency: true },
      },
    },
  });
  const room = stay?.selectedRoom;
  if (!stay || !room) return null;
  const today = todayIso(now);
  const quotedMinor = sellingMinor(room, stay.quote);
  const chosenAt = stay.selectedSellMinor !== null && stay.selectedSellMinor !== quotedMinor ? stay.selectedSellMinor : null;
  const profitThenMinor = (chosenAt ?? quotedMinor) - room.netMinor;
  const profitNowMinor = quotedMinor - booking.totalMinor;
  const freeThenDay = room.refundable ? room.freeCancelUntil : null;
  const last = lastFreeDay({ refundable: booking.refundable, cancelPenalties: booking.cancelPenalties as unknown as CancelPenalty[] });
  const freeNowDay = last && dayAhead(last, today) ? last : null;
  const clientView = clientCancelView(room, today);
  const profitLower = profitNowMinor < profitThenMinor;
  // Worse: there was a free-cancellation day and it is gone (the rate lost it, or the day passed)
  // or it comes earlier now.
  const termsWorse = freeThenDay !== null && (freeNowDay === null || freeNowDay < freeThenDay);
  const rateChanged = booking.rateId !== room.rateId || booking.bedGroupId !== room.bedGroupId || booking.roomId !== room.roomId;
  return {
    quoteId: stay.quote.id,
    number: stay.quote.agencyNumber ?? stay.quote.number,
    currency: room.currency,
    quotedMinor,
    priced: quotedSellMinor(room, stay.quote) !== null,
    chosenAtMinor: chosenAt,
    netThenMinor: room.netMinor,
    netNowMinor: booking.totalMinor,
    profitThenMinor,
    profitNowMinor,
    clientFreeDay: stay.quote.showCancellation && clientView.kind !== "none" ? (clientView.kind === "free" ? clientView.until : clientView.on) : null,
    freeThenDay,
    freeNowDay,
    rateChanged,
    profitLower,
    termsWorse,
    needsCheck: profitLower || termsWorse || rateChanged,
  };
}

export const QUOTE_CHECK_NEEDED = 'The price or the terms are not what the client was quoted. Tick "I checked the new price and terms" to book.';

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
