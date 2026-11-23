import { createHash } from "node:crypto";
import { z } from "zod";
import type { Money } from "@/lib/supplier-money";
import { db } from "@/server/db";
import {
  SupplierAuthError,
  SupplierError,
  SupplierNotSent,
  SupplierOutcomeUnknown,
  SupplierRequestRejected,
  SupplierUnavailable,
} from "@/server/supplier/expedia/client";
import type {
  AvailabilityQuery,
  BookInput,
  BookResult,
  BookingSupplier,
  CancelPenalty,
  DueAtProperty,
  Offer,
  PriceBreakdown,
  PriceCheckRef,
  PriceCheckResult,
  PropertyOffers,
  RetrievedItinerary,
  SupplierAdapter,
  SupplierRoomStatus,
} from "@/server/supplier/types";
import { type Env, type FxRule, type LayerEnvironment, convertToUsdMinor, layerEnvironment, readFxRule } from "./config";
import { type LayerAnswer, layerRequest } from "./client";

// Hotelbeds through the supplier layer service (owner decision 2026-11-23). The layer's API and
// answers are described in its README (branch claude/brave-goldberg-v7adee). This adapter turns
// them into the platform's own supplier model; nothing outside this folder knows the layer.
//
// - Hotels: the layer searches by its OWN hotel ids. Only the links an admin approved
//   (SupplierHotelMap, status APPROVED) are searched; an Expedia property without one gets none.
// - One room per search and booking (the layer refuses more for Hotelbeds until it is tested).
// - Money: integer minor units. USD rates are kept as they are. Another currency is kept only
//   with the temporary staging conversion (config.ts); otherwise, and always in production, the
//   offer is dropped, as the Expedia adapter drops non-USD rates.
// - Environment: outside production only "test" answers are used, in production only
//   "production" ones. An offer or quote from the other side is never sold.
// - Booking: the answer's `booked` decides, never the HTTP status. FAILED is a definite no;
//   any other status means the layer has the booking and its status is read again. Anything
//   that does not definitely mean "not booked" is SupplierOutcomeUnknown.
// - The booking reference: the platform's "APL-XXXXXXXX" (12 characters, A-Z, 2-9 and "-")
//   already fits the layer's clientReference rule; it is sent as it is, after a check.

const SEARCH_TIMEOUT_MS = 15_000; // the layer gives Hotelbeds up to 22 s; a slower answer is skipped
const QUOTE_TIMEOUT_MS = 30_000;
const BOOK_TIMEOUT_MS = 90_000; // the layer may look the booking up for ~20 s after an unclear answer
const READ_TIMEOUT_MS = 20_000;
const CANCEL_TIMEOUT_MS = 60_000;

export const CLIENT_REFERENCE = /^[A-Z0-9-]{6,20}$/;
const SAFE_ROOM_ID = /^[A-Za-z0-9._-]{1,64}$/;
const USD = "USD";

const money = z.object({ minor: z.number().int().safe(), currency: z.string().regex(/^[A-Z]{3}$/) });
const occupancy = z.object({ adults: z.number().int(), childrenAges: z.array(z.number().int()) });
const rateOffer = z.object({
  offerId: z.string().min(1).max(200),
  supplierId: z.string(),
  environment: z.enum(["test", "production"]),
  hotelId: z.string().min(1).max(100),
  ratePlanName: z.string().max(300).optional(),
  rooms: z.array(z.object({ occupancyIndex: z.number().int(), supplierRoomCode: z.string().max(200), roomName: z.string().max(300) })).min(1),
  board: z.string().max(20).optional(),
  total: money,
  payAtHotel: z.array(money).optional(),
  paymentModel: z.string(),
  cancellation: z.object({ refundable: z.boolean(), penalties: z.array(z.object({ from: z.string().max(40), amount: money })) }),
  checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  occupancy: z.array(occupancy),
});
type RateOffer = z.infer<typeof rateOffer>;
const searchAnswer = z.object({ offers: z.array(z.unknown()) });
const quoteAnswer = z.object({
  quoteId: z.string().min(1).max(100),
  environment: z.enum(["test", "production"]),
  offer: rateOffer,
  priceChanged: z.boolean(),
  cancellationChanged: z.boolean(),
});
const bookingAnswer = z.object({
  clientReference: z.string(),
  environment: z.enum(["test", "production"]),
  status: z.enum(["PENDING", "CONFIRMED", "ON_REQUEST", "FAILED", "UNKNOWN", "NEEDS_REVIEW", "CANCELLED"]),
  booked: z.boolean(),
  supplierBookingRef: z.string().max(100).optional(),
  hotelConfirmationNumber: z.string().max(100).optional(),
  reviewReason: z.string().optional(),
  cancelOutcomeUnknown: z.boolean().optional(),
  holder: z.object({ firstName: z.string(), lastName: z.string() }).optional(),
  guests: z.array(z.array(z.object({ firstName: z.string(), lastName: z.string() }))).optional(),
});
type BookingAnswer = z.infer<typeof bookingAnswer>;
const errorAnswer = z.object({ error: z.string() });

// The book token: the layer's quote and the total it quoted, in the layer's own currency (the
// layer refuses a booking above the approved total). Server-side only, like every token.
const bookToken = z.object({ q: z.string().min(1).max(100), m: z.number().int().nonnegative().safe(), c: z.string().regex(/^[A-Z]{3}$/) }).strict();

const BOARD_TEXT: Record<string, string> = {
  RO: "Room only",
  BB: "Breakfast included",
  HB: "Half board",
  FB: "Full board",
  AI: "All inclusive",
  UAI: "All inclusive",
};

// The approved links of these properties: our property id → the layer's hotel id.
export type HotelLinks = (propertyIds: string[]) => Promise<Map<string, string>>;

export const approvedLinks: HotelLinks = async (propertyIds) => {
  if (propertyIds.length === 0) return new Map();
  const rows = await db.supplierHotelMap.findMany({
    where: { supplier: "hotelbeds", status: "APPROVED", propertyId: { in: propertyIds } },
    select: { propertyId: true, layerHotelId: true },
  });
  return new Map(rows.map((row) => [row.propertyId, row.layerHotelId]));
};

function errorCode(answer: LayerAnswer): string | null {
  const parsed = errorAnswer.safeParse(answer.data);
  return parsed.success ? parsed.data.error : null;
}

// A read (search, quote, booking lookup) that did not answer 2xx.
function readFailure(answer: LayerAnswer, what: string): SupplierError {
  if (answer.status === 401 || answer.status === 403) return new SupplierAuthError(`The supplier layer refused the API key (HTTP ${answer.status})`, answer.status);
  if (answer.status >= 500 || answer.status < 200 || (answer.status >= 300 && answer.status < 400)) {
    return new SupplierUnavailable(`Supplier layer ${what} failed (HTTP ${answer.status})`, answer.status);
  }
  return new SupplierRequestRejected(`Supplier layer refused ${what} (HTTP ${answer.status}${errorCode(answer) ? ` ${errorCode(answer)}` : ""})`, answer.status);
}

function nightsBetween(checkin: string, checkout: string): number {
  return Math.round((Date.parse(`${checkout}T00:00:00Z`) - Date.parse(`${checkin}T00:00:00Z`)) / 86_400_000);
}

function opaqueId(prefix: string, value: string): string {
  return `${prefix}${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

export class HotelbedsLayer implements SupplierAdapter, BookingSupplier {
  private readonly links: HotelLinks;
  private readonly env: Env;

  constructor(options: { links?: HotelLinks; env?: Env } = {}) {
    this.links = options.links ?? approvedLinks;
    this.env = options.env ?? process.env;
  }

  private get environment(): LayerEnvironment {
    return layerEnvironment(this.env);
  }

  // USD as it is; the one staging currency converted; anything else null (the offer is dropped).
  private usd(amount: Money, fx: FxRule | null): Money | null {
    if (amount.currency === USD) return amount.minor >= 0 ? amount : null;
    if (!fx || amount.currency !== fx.currency) return null;
    const minor = convertToUsdMinor(amount.minor, fx, this.env);
    return minor === null ? null : { minor, currency: USD };
  }

  // One layer offer as the platform's Offer, or null when it cannot be sold as priced here.
  private toOffer(raw: RateOffer, propertyId: string, rooms: AvailabilityQuery["occupancies"], fx: FxRule | null): Offer | null {
    if (raw.supplierId !== "hotelbeds" || raw.environment !== this.environment || raw.paymentModel !== "PREPAID") return null;
    const [room] = raw.rooms;
    const [asked] = rooms;
    const [offered] = raw.occupancy;
    if (!room || raw.rooms.length !== 1 || rooms.length !== 1 || !asked || !offered || raw.occupancy.length !== 1) return null;
    if (offered.adults !== asked.adults || offered.childrenAges.join(",") !== asked.childAges.join(",")) return null;
    const nights = nightsBetween(raw.checkIn, raw.checkOut);
    if (!Number.isInteger(nights) || nights < 1) return null;

    const total = this.usd(raw.total, fx);
    if (!total) return null;
    const dueAtProperty: DueAtProperty[] = [];
    for (const fee of raw.payAtHotel ?? []) {
      const amount = this.usd(fee, fx);
      if (!amount) return null;
      dueAtProperty.push({ kind: "mandatory_fee", amount, localAmount: fee.currency === USD ? null : fee });
    }
    const dueSum = dueAtProperty.reduce((sum, fee) => sum + fee.amount.minor, 0);
    if (!Number.isSafeInteger(dueSum)) return null;

    // "From this moment on, cancelling costs X" → a window from that moment to the next one;
    // the last ends at midnight UTC of check-in (after that the stay counts as started). The
    // supplier's own date and offset are kept as given.
    const sorted = [...raw.cancellation.penalties].sort((a, b) => Date.parse(a.from) - Date.parse(b.from));
    if (sorted.some((p) => !Number.isFinite(Date.parse(p.from)))) return null;
    const checkinEnd = `${raw.checkIn}T00:00:00Z`;
    const cancelPenalties: CancelPenalty[] = [];
    for (const [i, penalty] of sorted.entries()) {
      const amount = this.usd(penalty.amount, fx);
      if (!amount) return null;
      const next = sorted[i + 1]?.from ?? checkinEnd;
      cancelPenalties.push({ start: penalty.from, end: Date.parse(next) > Date.parse(penalty.from) ? next : penalty.from, amount: { minor: Math.min(amount.minor, total.minor), currency: USD }, nights: null, percent: null });
    }

    const price: PriceBreakdown = {
      total,
      lines: [{ kind: "room_rate", amount: total }],
      dueAtProperty,
      dueAtPropertyTotal: dueAtProperty.length > 0 ? { minor: dueSum, currency: USD } : null,
      nights,
    };
    const board = raw.board ? BOARD_TEXT[raw.board.toUpperCase()] : undefined;
    const roomName = room.roomName.trim().slice(0, 300) || "Room";
    return {
      propertyId,
      roomId: SAFE_ROOM_ID.test(room.supplierRoomCode) ? room.supplierRoomCode : opaqueId("r", room.supplierRoomCode),
      roomName,
      rateId: opaqueId("h", raw.offerId),
      refundable: raw.cancellation.refundable,
      bedGroups: [{ id: "1", description: "Bed type as assigned by the hotel", priceCheckToken: raw.offerId }],
      cancelPenalties,
      nonrefundableDateRanges: [],
      amenities: board ? [board] : [],
      price,
      roomPrices: [price],
      supplier: "hotelbeds",
    };
  }

  async searchAvailability(query: AvailabilityQuery): Promise<PropertyOffers[]> {
    if (query.occupancies.length !== 1) return []; // one room only (the layer's Hotelbeds rule)
    const links = await this.links(query.propertyIds);
    if (links.size === 0) return [];
    const fx = readFxRule(this.env);
    const propertyOf = new Map<string, string>();
    for (const [propertyId, layerId] of links) if (!propertyOf.has(layerId)) propertyOf.set(layerId, propertyId);
    const [room] = query.occupancies;
    const answer = await layerRequest({
      method: "POST",
      path: "/v1/search",
      body: {
        checkIn: query.checkin,
        checkOut: query.checkout,
        rooms: [{ adults: room!.adults, childrenAges: room!.childAges }],
        hotelIds: [...propertyOf.keys()],
        currency: USD,
        ...(/^[A-Z]{2}$/.test(query.countryCode) ? { nationality: query.countryCode } : {}),
        suppliers: ["hotelbeds"],
      },
      timeoutMs: SEARCH_TIMEOUT_MS,
      changesState: false,
    }, this.env);
    if (answer.status !== 200) throw readFailure(answer, "the search");
    const parsed = searchAnswer.safeParse(answer.data);
    if (!parsed.success) throw new SupplierUnavailable("Supplier layer search answer could not be read");
    const byProperty = new Map<string, Offer[]>();
    for (const item of parsed.data.offers) {
      // One offer that does not read is dropped, not the whole search.
      const offer = rateOffer.safeParse(item);
      if (!offer.success) continue;
      const propertyId = propertyOf.get(offer.data.hotelId);
      if (!propertyId) continue; // a hotel we did not ask for
      const mapped = this.toOffer(offer.data, propertyId, query.occupancies, fx);
      if (mapped) byProperty.set(propertyId, [...(byProperty.get(propertyId) ?? []), mapped]);
    }
    return [...byProperty].map(([propertyId, offers]) => ({ propertyId, offers }));
  }

  async priceCheck(ref: PriceCheckRef): Promise<PriceCheckResult> {
    if (ref.occupancies.length !== 1 || ref.token.length < 1 || ref.token.length > 200 || /[\u0000-\u001f\u007f]/.test(ref.token)) return { status: "sold_out" };
    const fx = readFxRule(this.env);
    const answer = await layerRequest({ method: "POST", path: "/v1/quotes", body: { offerId: ref.token }, timeoutMs: QUOTE_TIMEOUT_MS, changesState: false }, this.env);
    // The rate is gone (409 SOLD_OUT) or the offer is older than the layer keeps it (410).
    if (answer.status === 409 || answer.status === 410) return { status: "sold_out" };
    if (answer.status !== 200) throw readFailure(answer, "the price check");
    const parsed = quoteAnswer.safeParse(answer.data);
    if (!parsed.success) throw new SupplierUnavailable("Supplier layer quote could not be read");
    const quote = parsed.data;
    // Another environment, another offer, or new cancellation terms: never booked as shown. The
    // agent searches again and sees the current terms (the stored terms would be out of date).
    if (quote.environment !== this.environment || quote.offer.offerId !== ref.token || quote.cancellationChanged) return { status: "sold_out" };
    const offer = this.toOffer(quote.offer, ref.propertyId, ref.occupancies, fx);
    if (!offer) return { status: "sold_out" };
    const token = Buffer.from(JSON.stringify({ q: quote.quoteId, m: quote.offer.total.minor, c: quote.offer.total.currency })).toString("base64url");
    return { status: quote.priceChanged ? "price_changed" : "available", price: offer.price, roomPrices: offer.roomPrices, bookToken: token };
  }

  async book(input: BookInput): Promise<BookResult> {
    const reference = input.affiliateReferenceId;
    if (!CLIENT_REFERENCE.test(reference)) throw new SupplierNotSent("The booking reference does not fit the supplier layer's rule");
    let token: z.infer<typeof bookToken>;
    try {
      token = bookToken.parse(JSON.parse(Buffer.from(input.bookToken, "base64url").toString("utf8")));
    } catch {
      throw new SupplierNotSent("The book token could not be read");
    }
    const [room] = input.rooms;
    if (!room || input.rooms.length !== 1) throw new SupplierNotSent("Hotelbeds bookings have one room");
    const adults = room.adults ?? 0;
    const childAges = room.childAges ?? [];
    const guests = room.guests ?? [];
    if (adults < 1 || guests.length !== adults + childAges.length) throw new SupplierNotSent("Every guest of the room is needed");
    const body = {
      clientReference: reference,
      quoteId: token.q,
      approvedTotal: { minor: token.m, currency: token.c },
      holder: { firstName: input.lead.givenName, lastName: input.lead.familyName, email: input.lead.email, phone: `+${input.lead.phone.countryCode} ${input.lead.phone.number}` },
      guests: [guests.map((guest, i) => (i < adults ? { firstName: guest.givenName, lastName: guest.familyName, type: "ADULT" } : { firstName: guest.givenName, lastName: guest.familyName, type: "CHILD", age: childAges[i - adults] }))],
      payment: { type: "AGENCY_CREDIT" },
      ...(input.specialRequest ? { specialRequests: input.specialRequest } : {}),
    };
    const answer = await layerRequest({ method: "POST", path: "/v1/bookings", body, timeoutMs: BOOK_TIMEOUT_MS, changesState: true, affiliateReferenceId: reference }, this.env);
    if (answer.status === 200 || answer.status === 201) {
      const parsed = bookingAnswer.safeParse(answer.data);
      if (!parsed.success || parsed.data.clientReference.toUpperCase() !== reference) throw new SupplierOutcomeUnknown("Supplier layer booking answer could not be read");
      const booking = parsed.data;
      // Not booked, for certain (the layer says so: safe to book again with a new quote).
      if (!booking.booked && booking.status === "FAILED") throw new SupplierRequestRejected("The supplier did not book it");
      // Booked, or the layer has it and is still finding out: the status is read next.
      return { itineraryId: booking.supplierBookingRef ?? reference, links: {} };
    }
    // Refused before the layer stored anything: nothing was booked.
    const code = errorCode(answer);
    if (answer.status === 401 || answer.status === 403) throw new SupplierAuthError(`The supplier layer refused the API key (HTTP ${answer.status})`, answer.status);
    if (answer.status === 400 || answer.status === 413 || answer.status === 415) throw new SupplierRequestRejected(`Supplier layer refused the booking (HTTP ${answer.status}${code ? ` ${code}` : ""})`, answer.status);
    if ((answer.status === 410 && code === "QUOTE_EXPIRED") || (answer.status === 409 && (code === "QUOTE_ALREADY_USED" || code === "PRICE_CHANGED"))) {
      throw new SupplierRequestRejected(`Supplier layer refused the booking (HTTP ${answer.status} ${code})`, answer.status);
    }
    // Anything else may mean a booking exists (REFERENCE_REUSED: this reference already has one).
    throw new SupplierOutcomeUnknown(`Supplier layer booking: no clear answer (HTTP ${answer.status}${code ? ` ${code}` : ""})`, answer.status);
  }

  private toItinerary(booking: BookingAnswer): RetrievedItinerary {
    const reference = booking.clientReference.toUpperCase();
    const status: SupplierRoomStatus =
      booking.environment !== this.environment
        ? "other" // a booking on the other side of the supplier: an admin looks at it
        : booking.status === "CONFIRMED"
          ? "booked"
          : booking.status === "ON_REQUEST" || booking.status === "UNKNOWN" || booking.status === "PENDING"
            ? "pending"
            : // FAILED: not booked (the layer says it is safe to book again); CANCELLED: cancelled.
              booking.status === "FAILED" || booking.status === "CANCELLED"
              ? "cancelled"
              : "other"; // NEEDS_REVIEW: a person must check with the supplier
    const guest = booking.guests?.[0]?.[0] ?? booking.holder;
    return {
      itineraryId: booking.supplierBookingRef ?? reference,
      ...(status === "booked" && booking.reviewReason ? { reviewNeeded: true } : {}),
      rooms: [
        {
          id: booking.supplierBookingRef ?? reference,
          status,
          hotelConfirmationId: booking.hotelConfirmationNumber ?? null,
          cancelLink: status === "booked" ? reference : null,
          givenName: guest?.firstName ?? null,
          familyName: guest?.lastName ?? null,
        },
      ],
    };
  }

  async findByAffiliateReference(ref: { affiliateReferenceId: string; email: string }): Promise<RetrievedItinerary | null> {
    const reference = ref.affiliateReferenceId;
    if (!CLIENT_REFERENCE.test(reference)) throw new SupplierNotSent("The booking reference does not fit the supplier layer's rule");
    const answer = await layerRequest({ method: "GET", path: `/v1/bookings/${reference}`, timeoutMs: READ_TIMEOUT_MS, changesState: false, affiliateReferenceId: reference }, this.env);
    if (answer.status === 404) return null;
    if (answer.status !== 200) throw readFailure(answer, "the booking lookup");
    const parsed = bookingAnswer.safeParse(answer.data);
    if (!parsed.success || parsed.data.clientReference.toUpperCase() !== reference) throw new SupplierUnavailable("Supplier layer booking answer could not be read");
    return this.toItinerary(parsed.data);
  }

  // The layer gives no retrieve links: every look goes by our reference (findByAffiliateReference).
  async retrieve(): Promise<RetrievedItinerary> {
    throw new SupplierRequestRejected("The supplier layer has no retrieve links");
  }

  // The cancel link of a layer booking is its reference (set by toItinerary, kept server-side).
  async cancelRoom(cancelLink: string): Promise<void> {
    if (!CLIENT_REFERENCE.test(cancelLink)) throw new SupplierNotSent("The cancel link does not fit the supplier layer's rule");
    const answer = await layerRequest({ method: "POST", path: `/v1/bookings/${cancelLink}/cancel`, timeoutMs: CANCEL_TIMEOUT_MS, changesState: true, affiliateReferenceId: cancelLink }, this.env);
    if (answer.status === 200) {
      const parsed = bookingAnswer.safeParse(answer.data);
      if (parsed.success && parsed.data.status === "CANCELLED" && parsed.data.clientReference.toUpperCase() === cancelLink) return;
      // NEEDS_REVIEW with cancelOutcomeUnknown, or an answer that does not read: the check finds out.
      throw new SupplierOutcomeUnknown("Supplier layer cancel: no clear answer");
    }
    const code = errorCode(answer);
    if (answer.status === 401 || answer.status === 403) throw new SupplierAuthError(`The supplier layer refused the API key (HTTP ${answer.status})`, answer.status);
    // Definitely not cancelled: refused, still active at the supplier, not possible by API, no
    // such booking, or a request the layer did not take.
    if (answer.status === 400 || answer.status === 404 || (answer.status === 409 && (code === "CANCEL_REFUSED" || code === "CANCEL_NOT_DONE" || code === "NOT_SUPPORTED"))) {
      throw new SupplierRequestRejected(`Supplier layer did not cancel (HTTP ${answer.status}${code ? ` ${code}` : ""})`, answer.status);
    }
    // NOT_CANCELLABLE (it may already be cancelled), 5xx, anything else: the check reads it.
    throw new SupplierOutcomeUnknown(`Supplier layer cancel: no clear answer (HTTP ${answer.status}${code ? ` ${code}` : ""})`, answer.status);
  }
}
