import type { Prisma } from "@/generated/prisma/client";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { SearchError } from "@/server/search/errors";
import { type SearchContext, searchOneHotel, snapshotOffers } from "@/server/search/search";
import type { Offer, SupplierAdapter } from "@/server/supplier/types";
import { clientDateAllowed, dayAhead, defaultClientDate, lastFreeDay, todayIso } from "./pricing";
import { ACTIVE_BOOKING, STAY_BOOKED, matchRate } from "./quote-booking";

// "Refresh prices" on a destination of a quote: each of its hotels is searched again (one hotel
// search each, through the normal search service and its limits), and every room option is found
// again in the fresh rates with the same rule as booking from a quote (matchRate). A room found
// gets the new net and terms in place; the agent's typed selling price and the client's pick stay
// as they are (the client's pick keeps the price the client saw, so a change shows on the quote).
// What changed is flagged on the room: price up or down (the net before), cancellation terms
// worse, or no longer available. The browser only names the destination.

export type RefreshSummary = { checked: number; up: number; down: number; worse: number; gone: number; failedHotels: number };
export type RefreshResult = { ok: true; id: string; summary: RefreshSummary } | { ok: false; error: string };

const NOT_FOUND = "This quote was not found.";

type QuotedRoom = {
  id: string;
  roomId: string;
  rateId: string;
  bedGroupId: string;
  refundable: boolean;
  bedDescription: string;
  amenities: string[];
  netMinor: number;
  freeCancelUntil: string | null;
  clientCancelUntil: string | null;
};

// What a refresh writes for one room: the found rate's net and terms, or "no longer available".
export function refreshedRoom(room: QuotedRoom, found: { offer: Offer; bedGroupId: string } | null, today: string, now: Date) {
  if (!found) return { kind: "gone" as const, data: { unavailable: true, needsRefresh: false, previousNetMinor: null, cancelWorse: false } };
  const { offer, bedGroupId } = found;
  const netMinor = offer.price.total.minor;
  const freeNow = lastFreeDay(offer);
  const freeThen = room.refundable ? room.freeCancelUntil : null;
  // Worse: there was a free-cancellation day and now there is none, or it comes earlier.
  const cancelWorse = freeThen !== null && (freeNow === null || freeNow < freeThen);
  // The client's date stays if it is still allowed with the new deadline; else the default (a
  // day before the supplier's) if that is still ahead; else none.
  const keep = freeNow && room.clientCancelUntil && clientDateAllowed(room.clientCancelUntil, freeNow, today) ? room.clientCancelUntil : null;
  const fallback = freeNow ? defaultClientDate(freeNow) : null;
  const clientCancelUntil = keep ?? (fallback && dayAhead(fallback, today) ? fallback : null);
  return {
    kind: netMinor > room.netMinor ? ("up" as const) : netMinor < room.netMinor ? ("down" as const) : ("same" as const),
    cancelWorse,
    data: {
      rateId: offer.rateId,
      bedGroupId,
      refundable: offer.refundable,
      freeCancelUntil: freeNow,
      clientCancelUntil,
      netMinor,
      currency: offer.price.total.currency,
      price: offer.price as unknown as Prisma.InputJsonValue,
      pricedAt: now,
      previousNetMinor: netMinor !== room.netMinor ? room.netMinor : null,
      cancelWorse,
      unavailable: false,
      needsRefresh: false,
    },
  };
}

export async function refreshStayPrices(ctx: SearchContext, stayId: string, deps: { adapter?: SupplierAdapter; now?: Date } = {}): Promise<RefreshResult> {
  const now = deps.now ?? new Date();
  if (typeof stayId !== "string" || stayId.length > 64) return { ok: false, error: NOT_FOUND };
  const stay = await db.quoteStay.findFirst({
    where: { id: stayId, quote: { agencyId: ctx.agencyId } },
    select: {
      id: true,
      quoteId: true,
      destinationId: true,
      checkin: true,
      checkout: true,
      quote: { select: { status: true, closedAt: true, adults: true, childAges: true } },
      hotels: { orderBy: { position: "asc" }, select: { id: true, propertyId: true } },
    },
  });
  if (!stay) return { ok: false, error: NOT_FOUND };
  if (stay.quote.status === "BOOKED") return { ok: false, error: "This quote is booked and can no longer change." };
  if (stay.quote.closedAt) return { ok: false, error: "This quote is closed. Choose Reopen quote to change it." };
  if (!dayAhead(stay.checkin, todayIso(now))) return { ok: false, error: "The check-in date of this destination has passed: there are no prices to refresh." };
  if ((await db.booking.count({ where: { agencyId: ctx.agencyId, quoteStayId: stay.id, status: { in: ACTIVE_BOOKING } } })) > 0) return { ok: false, error: STAY_BOOKED };
  if (stay.hotels.length === 0) return { ok: false, error: "This destination has no hotels yet." };

  // The searches run outside any transaction (they call the supplier); the results are written
  // in one transaction afterwards, with the quote locked and everything checked again.
  const offersByHotel = new Map<string, Offer[]>();
  let failedHotels = 0;
  for (const hotel of stay.hotels) {
    try {
      const { snapshotId } = await searchOneHotel(
        ctx,
        { destinationId: stay.destinationId, propertyId: hotel.propertyId, checkin: stay.checkin, checkout: stay.checkout, rooms: [{ adults: stay.quote.adults, childAges: stay.quote.childAges }] }, // quotes are one room
        deps,
      );
      offersByHotel.set(hotel.id, await snapshotOffers(ctx.agencyId, snapshotId, hotel.propertyId, now));
    } catch (error) {
      if (!(error instanceof SearchError)) throw error;
      // This hotel keeps its prices (not flagged); the others are still refreshed.
      failedHotels += 1;
    }
  }
  if (offersByHotel.size === 0) return { ok: false, error: "The prices could not be refreshed right now. Wait a minute and try again." };

  const today = todayIso(now);
  const summary: RefreshSummary = { checked: 0, up: 0, down: 0, worse: 0, gone: 0, failedHotels };
  const result = await db.$transaction(async (tx) => {
    const [locked] = await tx.$queryRaw<{ id: string; status: string; closedAt: Date | null }[]>`
      SELECT id, status, "closedAt" FROM "Quote" WHERE id = ${stay.quoteId} AND "agencyId" = ${ctx.agencyId} FOR UPDATE`;
    if (!locked) return { ok: false, error: NOT_FOUND } as const;
    if (locked.status === "BOOKED" || locked.closedAt) return { ok: false, error: "This quote can no longer change. Open it to see why." } as const;
    if ((await tx.booking.count({ where: { quoteStayId: stay.id, status: { in: ACTIVE_BOOKING } } })) > 0) return { ok: false, error: STAY_BOOKED } as const;
    for (const [hotelId, offers] of offersByHotel) {
      // Read under the lock: a room removed meanwhile is not written back.
      const rooms = await tx.quoteRoom.findMany({
        where: { hotelId, hotel: { stayId: stay.id } },
        select: { id: true, roomId: true, rateId: true, bedGroupId: true, refundable: true, bedDescription: true, amenities: true, netMinor: true, freeCancelUntil: true, clientCancelUntil: true },
      });
      const taken = new Set(rooms.map((r) => `${r.rateId}|${r.bedGroupId}`));
      for (const room of rooms) {
        const next = refreshedRoom(room, matchRate(offers, room), today, now);
        summary.checked += 1;
        if (next.kind === "gone") {
          summary.gone += 1;
          await tx.quoteRoom.update({ where: { id: room.id }, data: next.data });
          continue;
        }
        if (next.kind === "up") summary.up += 1;
        if (next.kind === "down") summary.down += 1;
        if (next.cancelWorse) summary.worse += 1;
        // The supplier may give the rate a new id. Another option of this hotel already holding
        // that id keeps it (one copy of a rate per hotel); this one keeps its old id.
        const key = `${next.data.rateId}|${next.data.bedGroupId}`;
        const own = `${room.rateId}|${room.bedGroupId}`;
        const data = key !== own && taken.has(key) ? { ...next.data, rateId: room.rateId, bedGroupId: room.bedGroupId } : next.data;
        if (key !== own && !taken.has(key)) {
          taken.delete(own);
          taken.add(key);
        }
        await tx.quoteRoom.update({ where: { id: room.id }, data });
      }
    }
    await tx.quote.update({ where: { id: stay.quoteId }, data: { editedAt: now } });
    await audit(ctx.userId, "quote.stay.refresh", "Quote", stay.quoteId, undefined, { stayId: stay.id, ...summary }, tx);
    return { ok: true, id: stay.quoteId, summary } as const;
  });
  return result;
}

// The line shown after a refresh.
export function refreshMessage(s: RefreshSummary): string {
  const parts = [
    s.up ? `${s.up} ${s.up === 1 ? "price went up" : "prices went up"}` : null,
    s.down ? `${s.down} ${s.down === 1 ? "price went down" : "prices went down"}` : null,
    s.worse ? `${s.worse} with worse cancellation terms` : null,
    s.gone ? `${s.gone} no longer available` : null,
  ].filter(Boolean);
  const head = parts.length ? `Prices refreshed: ${parts.join(", ")}. The changed rooms are marked below.` : "Prices refreshed: nothing changed.";
  return s.failedHotels ? `${head} ${s.failedHotels} ${s.failedHotels === 1 ? "hotel" : "hotels"} could not be checked right now; try again in a minute.` : head;
}
