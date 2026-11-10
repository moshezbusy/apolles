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
