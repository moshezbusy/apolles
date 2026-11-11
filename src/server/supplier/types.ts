import type { Money } from "@/lib/supplier-money";

// The supplier-neutral model. Only the supplier adapter (src/server/supplier/expedia/*) knows
// Expedia's field names; services and UI use these types. All money is integer minor units.

export type Occupancy = { adults: number; childAges: number[] };

export type AvailabilityQuery = {
  propertyIds: string[]; // 1 to 250
  checkin: string; // YYYY-MM-DD
  checkout: string; // YYYY-MM-DD
  occupancy: Occupancy; // one room in phase 1
  countryCode: string; // the agency's country: the point of sale (TR2)
};

// One line of the price breakdown (BP5 / CP1 / ER6). "Taxes and fees" is a single line: the
// sum of tax_and_service_fee, recovery_charges_and_fees and property_fee.
export type PriceLineKind = "room_rate" | "extra_person_fee" | "taxes_and_fees" | "taxes" | "discount" | "service_fee";
export type PriceLine = { kind: PriceLineKind; amount: Money };

// A charge the guest pays at the property (BP4): shown in the request currency and, when
// different, in the local (billable) currency too.
export type DueAtProperty = {
  kind: "mandatory_fee" | "resort_fee" | "mandatory_tax";
  amount: Money; // request currency (USD)
  localAmount: Money | null; // the property's currency, when it differs
};

export type PriceBreakdown = {
  total: Money; // Expedia's inclusive total: what the agency pays now. Never recomputed.
  lines: PriceLine[]; // as given by Expedia, summed by kind
  dueAtProperty: DueAtProperty[];
  dueAtPropertyTotal: Money | null;
  nights: number;
};

export type CancelPenalty = {
  start: string; // ISO date-time with the property's offset, as given
  end: string;
  amount: Money | null;
  nights: number | null;
  percent: string | null; // e.g. "100%", as given
};

export type BedGroup = { id: string; description: string; priceCheckToken: string };

export type Offer = {
  propertyId: string;
  roomId: string;
  roomName: string;
  rateId: string;
  refundable: boolean;
  bedGroups: BedGroup[];
  cancelPenalties: CancelPenalty[];
  nonrefundableDateRanges: { start: string; end: string }[];
  price: PriceBreakdown;
};

export type PropertyOffers = { propertyId: string; offers: Offer[] };

export type PriceCheckResult =
  | { status: "available"; price: PriceBreakdown; bookToken: string }
  | { status: "price_changed"; price: PriceBreakdown; bookToken: string }
  | { status: "sold_out" };

export type SupplierContext = { customerIp?: string; userAgent?: string; sessionId?: string };

export interface SupplierAdapter {
  searchAvailability(query: AvailabilityQuery, context: SupplierContext): Promise<PropertyOffers[]>;
  priceCheck(
    ref: { propertyId: string; roomId: string; rateId: string; token: string },
    context: SupplierContext,
  ): Promise<PriceCheckResult>;
}

// ---------- content (plan 2b) ----------
// Destinations, the hotel catalog and per-hotel content. Supplier text (descriptions, policies,
// fees) is kept exactly as given and may contain HTML: it must be rendered safely (plan 2c).

export type RegionInfo = {
  id: string;
  name: string;
  nameFull: string;
  type: "city" | "multi_city_vicinity";
  countryCode: string;
  propertyIds: string[];
};

export type Image = { url: string; caption: string | null }; // url is always https

export type RoomContent = { id: string; name: string; images: Image[]; amenities: string[]; maxOccupancy: number | null };

export type PropertyContent = {
  propertyId: string;
  name: string;
  address: { line1: string; city: string; stateProvince: string | null; postalCode: string | null; countryCode: string };
  starRating: string | null; // as given, e.g. "4.5"
  coordinates: { lat: string; lng: string } | null; // decimal strings, never floats in arithmetic
  heroImage: Image | null;
  images: Image[];
  amenities: string[];
  checkin: {
    beginTime: string | null;
    endTime: string | null;
    instructions: string | null;
    specialInstructions: string | null;
    minAge: number | null;
  };
  checkout: { time: string | null };
  fees: { mandatory: string | null; optional: string | null };
  knowBeforeYouGo: string | null;
  description: string | null;
  onsiteCurrency: string | null;
  rooms: RoomContent[];
};

// `next` is an opaque "next page" path from the supplier, followed exactly as given.
export interface ContentSource {
  listRegions(q: { countryCode: string; next?: string }): Promise<{ regions: RegionInfo[]; next: string | null }>;
  catalogLink(): Promise<{ href: string }>;
  propertyContent(ids: string[]): Promise<PropertyContent[]>;
  inactiveSince(q: { since: string; next?: string }): Promise<{ propertyIds: string[]; next: string | null }>;
}

// ---------- booking (plan 3) ----------
// One room per booking in phase 1. Links are the supplier's own hrefs (with their tokens),
// kept server-side and followed exactly as given.

export type Phone = { countryCode: string; number: string }; // digits only, e.g. "972", "501234567"

export type BookInput = {
  bookToken: string; // from the latest price check
  affiliateReferenceId: string; // the Apolles reference (TR1), unique per booking
  lead: { givenName: string; familyName: string; email: string; phone: Phone };
};

export type SupplierLinks = { retrieve?: string; cancel?: string };

export type BookResult = { itineraryId: string; links: SupplierLinks };

export type SupplierRoomStatus = "booked" | "pending" | "cancelled" | "other";

export type RetrievedItinerary = {
  itineraryId: string;
  rooms: { id: string; status: SupplierRoomStatus; hotelConfirmationId: string | null; cancelLink: string | null }[];
};

export interface BookingSupplier {
  // A definite "no" throws SupplierRequestRejected (or SupplierAuthError); an answer that is
  // not known (timeout, 5xx, network) throws SupplierOutcomeUnknown: never book again then.
  book(input: BookInput, context: SupplierContext): Promise<BookResult>;
  // null when the supplier says there is no such booking.
  findByAffiliateReference(ref: { affiliateReferenceId: string; email: string }, context: SupplierContext): Promise<RetrievedItinerary | null>;
  retrieve(links: SupplierLinks, context: SupplierContext): Promise<RetrievedItinerary>;
  cancelRoom(cancelLink: string, context: SupplierContext): Promise<void>;
}
