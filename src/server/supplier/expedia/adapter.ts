import { z } from "zod";
import { InvalidAmount, type Money, parseAmount } from "@/lib/supplier-money";
import type {
  AvailabilityQuery,
  BedGroup,
  CancelPenalty,
  DueAtProperty,
  Occupancy,
  Offer,
  PriceBreakdown,
  PriceCheckResult,
  PriceLine,
  PriceLineKind,
  PropertyOffers,
  SupplierAdapter,
  SupplierContext,
} from "@/server/supplier/types";
import { SupplierError, expediaRequest, recordUnknownFields } from "./client";

// Expedia Rapid v3 → the supplier-neutral model (src/server/supplier/types.ts).
// Built from the official OpenAPI spec (docs/research/expedia-api/rapid-3-specs.yaml).
//
// Validation (owner decision 2026-11-10): every field we use is checked strictly; fields we
// do not know are dropped and their names recorded in the supplier log, so a new Expedia field
// never stops search. Each property, room and rate is checked on its own: a bad one is dropped
// (and named in the log) and the rest of the search still works. A response that is broken as
// a whole is SupplierResponseInvalid. An offer is never built from a partial price.
//
// Phase-1 rules applied here:
// - Only rates billed in USD (wallets are USD, BP5 forbids conversion). Others are dropped.
// - No package rates (AP4) and no property-collect rates (GR5/BP8): Expedia is the merchant.
// - The total is Expedia's inclusive total, never recomputed from the lines (BP5).

export class SupplierResponseInvalid extends SupplierError {}

const SHOPPING_TIMEOUT_MS = 15_000;
const MAX_PROPERTIES_PER_CALL = 250;
const CURRENCY = "USD";
const SAFE_ID = /^[A-Za-z0-9_-]{1,200}$/; // property, room and rate ids and tokens in a path or query

// ---------- schemas ----------
// Built twice from one definition: with z.object (unknown keys dropped) for the data, and with
// z.strictObject only to list the unknown keys for the log.
type ObjectFactory = typeof z.object;

function schemas(object: ObjectFactory) {
  const unused = z.unknown().optional(); // a field Expedia documents but we do not use
  const amount = object({ value: z.string(), currency: z.string() });
  const charge = object({ billable_currency: amount, request_currency: amount });
  // The charge type stays a string here: a type we do not know drops the rate in mapping,
  // instead of failing the whole response.
  const line = object({ type: z.string(), value: z.string(), currency: z.string() });
  const link = object({ method: z.string(), href: z.string(), expires: unused, required_parameters: unused });
  const pricing = object({
    nightly: z.array(z.array(line)).min(1),
    stay: z.array(line).optional(),
    totals: object({
      inclusive: charge,
      exclusive: charge.optional(),
      property_fees: charge.optional(),
      property_inclusive: unused,
      inclusive_strikethrough: unused,
      strikethrough: unused,
      property_inclusive_strikethrough: unused,
      marketing_fee: unused,
      gross_profit: unused,
      minimum_selling_price: unused,
    }),
    fees: object({ mandatory_fee: charge.optional(), resort_fee: charge.optional(), mandatory_tax: charge.optional() }).optional(),
    marketing_fee_details: unused,
  });
  const bedGroup = object({
    id: z.string(),
    description: z.string(),
    configuration: unused,
    links: object({ price_check: link }),
  });
  const cancelPenalty = object({
    currency: z.string(),
    start: z.string(),
    end: z.string(),
    amount: z.string().optional(),
    nights: z.string().regex(/^\d+$/).optional(),
    percent: z.string().optional(),
  });
  const rate = object({
    id: z.string(),
    status: z.string().optional(),
    refundable: z.boolean(),
    merchant_of_record: z.string().optional(),
    sale_scenario: object({
      package: z.boolean().optional(),
      member: unused,
      corporate: unused,
      distribution: unused,
      mobile_promotion: unused,
    }).optional(),
    bed_groups: z.record(z.string(), bedGroup),
    cancel_penalties: z.array(cancelPenalty).optional(),
    nonrefundable_date_ranges: z.array(object({ start: z.string(), end: z.string() })).optional(),
    occupancy_pricing: z.record(z.string(), pricing),
    available_rooms: unused,
    holdable: unused,
    current_refundability: unused,
    member_deal_available: unused,
    amenities: unused,
    links: unused,
    marketing_fee_incentives: unused,
    promotions: unused,
    card_on_file_limit: unused,
    refundable_damage_deposit: unused,
    deposits: unused,
  });
  // Shells: the outer levels are checked without their children, which are checked one by one.
  const room = object({ id: z.string(), room_name: z.string(), rates: z.array(z.unknown()) });
  const property = object({
    property_id: z.string(),
    status: z.enum(["available", "partially_unavailable"]),
    rooms: z.array(z.unknown()).optional(),
    score: unused,
    links: unused,
    unavailable_reason: unused,
  });
  const priceCheck = object({
    status: z.enum(["available", "available_no_change", "price_changed", "sold_out"]),
    occupancy_pricing: z.record(z.string(), pricing).optional(),
    links: object({
      book: link.optional(),
      commit: unused,
      payment_session: unused,
      additional_rates: unused,
      shop: unused,
    }).optional(),
    holdable: unused,
    card_on_file_limit: unused,
    refundable_damage_deposit: unused,
    deposits: unused,
    refund: unused,
    amount_owed: unused,
    penalty: unused,
    trader_information: unused,
  });
  return { property, room, rate, pricing, priceCheck };
}

const lenient = schemas(z.object);
const strict = schemas(z.strictObject as unknown as ObjectFactory);

type Pricing = z.infer<typeof lenient.pricing>;
type Rate = z.infer<typeof lenient.rate>;

// Notes for the supplier log: names of unknown fields, and "invalid:<path>" for dropped items.
class ParseNotes {
  readonly names: string[] = [];
  invalid(path: string): void {
    this.names.push(`invalid:${path}`);
  }
}

function formatPath(path: readonly PropertyKey[]): string {
  return path.map((part) => (typeof part === "number" ? `[${part}]` : `.${String(part)}`)).join("").replace(/^\./, "");
}

// Checks one item. Returns null (and notes it) when it does not fit; records unknown keys.
function check<T>(lenientSchema: z.ZodType<T>, strictSchema: z.ZodType<unknown>, data: unknown, at: string, notes: ParseNotes): T | null {
  const result = lenientSchema.safeParse(data);
  if (!result.success) {
    const first = result.error.issues[0];
    notes.invalid(`${at}${first ? `.${formatPath(first.path)}` : ""}`.replace(/^\./, ""));
    return null;
  }
  const probe = strictSchema.safeParse(data);
  if (!probe.success) {
    for (const issue of probe.error.issues) {
      if (issue.code !== "unrecognized_keys") continue;
      const base = [at, formatPath(issue.path)].filter(Boolean).join(".");
      for (const key of issue.keys) notes.names.push(base ? `${base}.${key}` : key);
    }
  }
  return result.data;
}

// ---------- mapping ----------
export function occupancyKey(occupancy: Occupancy): string {
  return occupancy.childAges.length ? `${occupancy.adults}-${occupancy.childAges.join(",")}` : String(occupancy.adults);
}

const LINE_KIND: Record<string, PriceLineKind> = {
  base_rate: "room_rate",
  tax_and_service_fee: "taxes_and_fees",
  recovery_charges_and_fees: "taxes_and_fees",
  property_fee: "taxes_and_fees",
  sales_tax: "taxes",
  extra_person_fee: "extra_person_fee",
  adjustment: "discount",
  traveler_service_fee: "service_fee",
};
const LINE_ORDER: PriceLineKind[] = ["room_rate", "taxes_and_fees", "taxes", "extra_person_fee", "service_fee", "discount"];

// A rate we drop: not sellable in phase 1 (currency, unknown charge type) or not well formed.
class DropRate extends Error {}

function money(value: string, currency: string, allowNegative = false): Money {
  try {
    return parseAmount(value, currency, { allowNegative });
  } catch (error) {
    if (error instanceof InvalidAmount) throw new DropRate(error.message);
    throw error;
  }
}

function usd(amount: { value: string; currency: string }): Money {
  if (amount.currency !== CURRENCY) throw new DropRate(`billed in ${amount.currency}`);
  return money(amount.value, amount.currency);
}

function add(sum: number, minor: number): number {
  const next = sum + minor;
  if (!Number.isSafeInteger(next)) throw new DropRate("amount overflow");
  return next;
}

function tokenOf(href: string): string {
  const token = new URL(href, "https://test.ean.com").searchParams.get("token");
  if (!token) throw new DropRate("link has no token");
  return token;
}

export function toBreakdown(pricing: Pricing): PriceBreakdown {
  const { inclusive } = pricing.totals;
  if (inclusive.request_currency.currency !== CURRENCY) throw new DropRate(`requested in ${inclusive.request_currency.currency}`);
  const total = usd(inclusive.billable_currency);

  const sums = new Map<PriceLineKind, number>();
  for (const line of [...pricing.nightly.flat(), ...(pricing.stay ?? [])]) {
    const kind = LINE_KIND[line.type];
    if (!kind) throw new DropRate(`unknown charge type ${line.type}`); // never summed into the wrong line
    if (line.currency !== CURRENCY) throw new DropRate(`line in ${line.currency}`);
    const amount = money(line.value, line.currency, line.type === "adjustment");
    sums.set(kind, add(sums.get(kind) ?? 0, amount.minor));
  }
  const lines: PriceLine[] = LINE_ORDER.filter((kind) => sums.has(kind)).map((kind) => ({
    kind,
    amount: { minor: sums.get(kind) ?? 0, currency: CURRENCY },
  }));

  const dueAtProperty: DueAtProperty[] = [];
  for (const kind of ["mandatory_fee", "resort_fee", "mandatory_tax"] as const) {
    const fee = pricing.fees?.[kind];
    if (!fee) continue;
    const amount = usd(fee.request_currency);
    let localAmount: Money | null = null;
    if (fee.billable_currency.currency !== fee.request_currency.currency) {
      try {
        localAmount = parseAmount(fee.billable_currency.value, fee.billable_currency.currency);
      } catch {
        localAmount = null; // the USD amount is still shown; only the local one is missing
      }
    }
    dueAtProperty.push({ kind, amount, localAmount });
  }
  const feesTotal = pricing.totals.property_fees;
  const dueAtPropertyTotal = feesTotal ? usd(feesTotal.request_currency) : null;

  return { total, lines, dueAtProperty, dueAtPropertyTotal, nights: pricing.nightly.length };
}

function toOffer(propertyId: string, room: { id: string; room_name: string }, rate: Rate, occupancy: string): Offer | null {
  if (rate.sale_scenario?.package) return null; // AP4: no package rates
  if (rate.merchant_of_record !== undefined && rate.merchant_of_record !== "expedia") return null; // no property collect
  const pricing = rate.occupancy_pricing[occupancy];
  if (!pricing) return null;
  try {
    const bedGroups: BedGroup[] = Object.values(rate.bed_groups).map((group) => ({
      id: group.id,
      description: group.description,
      priceCheckToken: tokenOf(group.links.price_check.href),
    }));
    const cancelPenalties: CancelPenalty[] = (rate.cancel_penalties ?? []).map((penalty) => {
      if (penalty.currency !== CURRENCY) throw new DropRate(`penalty in ${penalty.currency}`);
      return {
        start: penalty.start,
        end: penalty.end,
        amount: penalty.amount === undefined ? null : money(penalty.amount, penalty.currency),
        nights: penalty.nights === undefined ? null : Number(penalty.nights),
        percent: penalty.percent ?? null,
      };
    });
    return {
      propertyId,
      roomId: room.id,
      roomName: room.room_name,
      rateId: rate.id,
      refundable: rate.refundable,
      bedGroups,
      cancelPenalties,
      nonrefundableDateRanges: rate.nonrefundable_date_ranges ?? [],
      price: toBreakdown(pricing),
    };
  } catch (error) {
    if (error instanceof DropRate) return null;
    throw error;
  }
}

// ---------- adapter ----------
export class ExpediaAdapter implements SupplierAdapter {
  async searchAvailability(query: AvailabilityQuery, context: SupplierContext): Promise<PropertyOffers[]> {
    if (query.propertyIds.length < 1 || query.propertyIds.length > MAX_PROPERTIES_PER_CALL) {
      throw new Error(`searchAvailability takes 1 to ${MAX_PROPERTIES_PER_CALL} property ids`);
    }
    const occupancy = occupancyKey(query.occupancy);
    const { data, logId } = await expediaRequest({
      method: "GET",
      path: "/properties/availability",
      query: {
        checkin: query.checkin,
        checkout: query.checkout,
        currency: CURRENCY,
        country_code: query.countryCode,
        language: "en-US",
        occupancy,
        property_id: query.propertyIds,
        rate_plan_count: MAX_PROPERTIES_PER_CALL,
        sales_channel: "agent_tool",
        sales_environment: "hotel_only",
      },
      context,
      timeoutMs: SHOPPING_TIMEOUT_MS,
    });
    const list = data ?? [];
    if (!Array.isArray(list)) throw new SupplierResponseInvalid("Expedia availability response is not a list");

    const notes = new ParseNotes();
    const result: PropertyOffers[] = [];
    list.forEach((rawProperty, p) => {
      const property = check(lenient.property, strict.property, rawProperty, `[${p}]`, notes);
      if (!property) return;
      const offers: Offer[] = [];
      (property.rooms ?? []).forEach((rawRoom, r) => {
        const room = check(lenient.room, strict.room, rawRoom, `[${p}].rooms[${r}]`, notes);
        if (!room) return;
        room.rates.forEach((rawRate, t) => {
          const rate = check(lenient.rate, strict.rate, rawRate, `[${p}].rooms[${r}].rates[${t}]`, notes);
          const offer = rate ? toOffer(property.property_id, room, rate, occupancy) : null;
          if (offer) offers.push(offer);
        });
      });
      if (offers.length > 0) result.push({ propertyId: property.property_id, offers });
    });
    await recordUnknownFields(logId, notes.names);
    return result;
  }

  async priceCheck(
    ref: { propertyId: string; roomId: string; rateId: string; token: string },
    context: SupplierContext,
  ): Promise<PriceCheckResult> {
    for (const value of [ref.propertyId, ref.roomId, ref.rateId, ref.token]) {
      if (!SAFE_ID.test(value)) throw new Error("priceCheck: invalid id or token");
    }
    const { data, logId } = await expediaRequest({
      method: "GET",
      path: `/properties/${ref.propertyId}/rooms/${ref.roomId}/rates/${ref.rateId}`,
      query: { token: ref.token },
      context,
      timeoutMs: SHOPPING_TIMEOUT_MS,
    });
    const notes = new ParseNotes();
    const value = check(lenient.priceCheck, strict.priceCheck, data, "", notes);
    await recordUnknownFields(logId, notes.names);
    if (!value) throw new SupplierResponseInvalid("Expedia price check response is invalid");

    if (value.status === "sold_out") return { status: "sold_out" };
    // Phase 1 books one room, so the response holds one occupancy.
    const pricing = Object.values(value.occupancy_pricing ?? {})[0];
    const book = value.links?.book;
    if (!pricing || !book) throw new SupplierResponseInvalid("Expedia price check has no pricing or book link");
    try {
      const price = toBreakdown(pricing);
      const status = value.status === "price_changed" ? "price_changed" : "available";
      return { status, price, bookToken: tokenOf(book.href) };
    } catch (error) {
      // A rate that cannot be sold as priced now (e.g. no longer USD) is treated as sold out.
      if (error instanceof DropRate) return { status: "sold_out" };
      throw error;
    }
  }
}
