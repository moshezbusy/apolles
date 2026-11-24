import { z } from "zod";
import { cancellationSummary, freeCancellation } from "@/lib/cancellation";
import { formatMinor, type Money } from "@/lib/supplier-money";
import type { getContent } from "@/server/content/content-cache";
import { suggestDestinations } from "@/server/search/destinations";
import { SearchInputInvalid, SearchRateLimited, SearchUnavailable } from "@/server/search/errors";
import { roomSchema } from "@/server/search/input";
import { getHotelOffers, listResults, searchSummary, startSearch } from "@/server/search/search";
import type { DueAtProperty, PriceLineKind, SupplierAdapter } from "@/server/supplier/types";

// The two things an AI assistant can do (plan 2026-11-22-mcp-search-connector): search hotels and
// read one hotel's rates. Both run the same search service as the Search page (same checks, same
// per-user and per-agency limits, the same 30-minute stored search, scoped by the agency), and
// answer with what the agent would see there, plus a link to open the result in Apolles to book.
//
// Never in an answer: the supplier's name (GR1), rate ids, price-check tokens, and anything about
// guests, clients, bookings or the balance (none of it is read here).

type Who = { agencyId: string; userId: string };
type Deps = { adapter?: SupplierAdapter; now?: Date; content?: typeof getContent; appUrl?: string };

export type ToolResult<T> = { ok: true; data: T } | { ok: false; code: "invalid_input" | "not_found" | "rate_limited" | "unavailable"; message: string };

const MAX_HOTELS = 20;
const MAX_RATES = 30;

const searchArgs = z
  .object({
    destination: z.string().trim().min(2).max(60).optional(),
    destinationId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
    checkin: z.string(),
    checkout: z.string(),
    rooms: z.array(roomSchema).min(1).max(8),
    hotelName: z.string().trim().max(100).optional(),
    stars: z.array(z.number().int().min(1).max(5)).max(5).optional(),
    freeCancellationOnly: z.boolean().optional(),
    maxTotalPrice: z.number().int().min(1).max(10_000_000).optional(), // whole US dollars, the whole stay
    sort: z.enum(["recommended", "price_asc", "price_desc", "stars_desc"]).optional(),
    limit: z.number().int().min(1).max(MAX_HOTELS).optional(),
  })
  .strict()
  .refine((v) => (v.destination === undefined) !== (v.destinationId === undefined), { message: "destination or destinationId" });

const ratesArgs = z
  .object({ searchId: z.string().regex(/^[a-z0-9]{1,64}$/), hotelId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) })
  .strict();

const LINE_LABEL: Record<PriceLineKind, string> = {
  room_rate: "Room",
  extra_person_fee: "Extra person fee",
  taxes_and_fees: "Taxes and fees",
  taxes: "Taxes",
  discount: "Discount",
  service_fee: "Service fee",
};
const DUE_LABEL: Record<DueAtProperty["kind"], string> = { mandatory_fee: "Mandatory fee", resort_fee: "Resort fee", mandatory_tax: "Mandatory tax" };

// "4.0" and "4" are the same rating (the results list and the hotel read it differently).
const stars = (value: string | null) => (value === null ? null : value.replace(/\.0+$/, ""));
const money = (m: Money) => formatMinor(m.minor, m.currency);
// Integer minor units: the per-night figure is rounded to a whole minor unit and called an average.
const perNight = (m: Money, nights: number) => formatMinor(Math.round(m.minor / Math.max(1, nights)), m.currency);

function hotelLink(appUrl: string, searchId: string, hotelId: string): string {
  return `${appUrl}/search/${encodeURIComponent(searchId)}/hotels/${encodeURIComponent(hotelId)}`;
}

function appBase(deps: Deps): string {
  const raw = deps.appUrl ?? process.env.APP_URL ?? "";
  const parsed = z.url({ protocol: /^https?$/ }).safeParse(raw);
  return parsed.success ? new URL(parsed.data).origin : "";
}

function failure(error: unknown): ToolResult<never> {
  if (error instanceof SearchInputInvalid) return { ok: false, code: "invalid_input", message: error.message };
  if (error instanceof SearchRateLimited) return { ok: false, code: "rate_limited", message: error.message };
  if (error instanceof SearchUnavailable) return { ok: false, code: "unavailable", message: error.message };
  console.error(`assistant search failed: ${error instanceof Error ? error.name : "Error"}`);
  return { ok: false, code: "unavailable", message: "Hotel search is unavailable right now. Try again in a few minutes." };
}

export type AssistantHotel = {
  hotelId: string;
  name: string;
  stars: string | null;
  area: string;
  priceFrom: { total: string; averagePerNight: string };
  freeCancellationAvailable: boolean;
  payAtHotelFees: boolean;
  openInApolles: string;
};

export type AssistantSearch = {
  searchId: string;
  destination: { id: string; name: string };
  otherDestinations: { id: string; name: string }[];
  checkin: string;
  checkout: string;
  nights: number;
  hotelsFound: number;
  hotels: AssistantHotel[];
  note: string;
};

const NOTE =
  "Prices are the agency's net price for the whole stay in the shown currency, before the agency's markup. " +
  "They are checked again before the agent books. To book, open the hotel in Apolles. Results stay open for 30 minutes.";

export async function assistantSearchHotels(who: Who, raw: unknown, deps: Deps = {}): Promise<ToolResult<AssistantSearch>> {
  const parsed = searchArgs.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "invalid_input", message: "Give a destination (or destinationId), check-in and check-out dates (YYYY-MM-DD) and the rooms with adults and children's ages." };
  const args = parsed.data;
  const now = deps.now ?? new Date();

  let destination: { id: string; label: string };
  let others: { id: string; label: string }[] = [];
  if (args.destination !== undefined) {
    const found = await suggestDestinations(args.destination, 5);
    if (found.length === 0) return { ok: false, code: "not_found", message: `No destination matches "${args.destination}". Try the city's name in English.` };
    destination = found[0]!;
    others = found.slice(1);
  } else {
    destination = { id: args.destinationId!, label: "" };
  }

  try {
    const ctx = { ...who, supplierContext: {} };
    const { snapshotId } = await startSearch(ctx, { destinationId: destination.id, checkin: args.checkin, checkout: args.checkout, rooms: args.rooms }, { ...(deps.adapter ? { adapter: deps.adapter } : {}), now, ...(deps.content ? { content: deps.content } : {}) });
    const [page, summary] = await Promise.all([
      listResults(who.agencyId, snapshotId, {
        sort: args.sort ?? "recommended",
        take: args.limit ?? 10,
        ...(args.hotelName ? { name: args.hotelName } : {}),
        ...(args.stars ? { stars: args.stars } : {}),
        ...(args.freeCancellationOnly ? { freeCancellation: true } : {}),
        ...(args.maxTotalPrice ? { maxPriceMinor: args.maxTotalPrice * 100 } : {}),
      }, now),
      searchSummary(who.agencyId, snapshotId, now),
    ]);
    if (!page || !summary) return failure(new Error("stored search not readable"));
    const base = appBase(deps);
    return {
      ok: true,
      data: {
        searchId: snapshotId,
        destination: { id: destination.id, name: summary.destinationLabel || destination.label },
        otherDestinations: others.map((d) => ({ id: d.id, name: d.label })),
        checkin: summary.checkin,
        checkout: summary.checkout,
        nights: summary.nights,
        hotelsFound: page.total,
        hotels: page.hotels.map((h) => ({
          hotelId: h.propertyId,
          name: h.name,
          stars: stars(h.starRating),
          area: h.city,
          priceFrom: { total: money(h.minTotal), averagePerNight: perNight(h.minTotal, summary.nights) },
          freeCancellationAvailable: h.refundableAvailable,
          payAtHotelFees: h.feesAtProperty,
          openInApolles: hotelLink(base, snapshotId, h.propertyId),
        })),
        note: NOTE,
      },
    };
  } catch (error) {
    return failure(error);
  }
}

export type AssistantRate = {
  room: string;
  beds: string[];
  includes: string[];
  total: string;
  averagePerNight: string;
  priceLines: { label: string; amount: string }[];
  payAtHotel: { label: string; amount: string; localAmount: string | null }[];
  freeCancellation: boolean;
  cancellation: string;
};

export type AssistantRates = {
  hotel: { hotelId: string; name: string; stars: string | null; area: string };
  checkin: string;
  checkout: string;
  nights: number;
  rates: AssistantRate[];
  openInApolles: string;
  note: string;
};

const EXPIRED = "This search is no longer open (results stay open for 30 minutes), or the hotel is not in it. Run search_hotels again.";

export async function assistantHotelRates(who: Who, raw: unknown, deps: Deps = {}): Promise<ToolResult<AssistantRates>> {
  const parsed = ratesArgs.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "invalid_input", message: "Give the searchId and hotelId from search_hotels." };
  const { searchId, hotelId } = parsed.data;
  const now = deps.now ?? new Date();
  try {
    const [found, summary] = await Promise.all([
      getHotelOffers(who, searchId, hotelId, now, deps.content ? { content: deps.content } : {}),
      searchSummary(who.agencyId, searchId, now),
    ]);
    if (!found || !summary || summary.expired) return { ok: false, code: "not_found", message: EXPIRED };
    const rates = [...found.offers]
      .sort((a, b) => a.price.total.minor - b.price.total.minor)
      .slice(0, MAX_RATES)
      .map((offer) => ({
        room: offer.roomName,
        beds: offer.bedGroups.map((b) => b.description),
        includes: offer.amenities,
        total: money(offer.price.total),
        averagePerNight: perNight(offer.price.total, offer.price.nights),
        priceLines: offer.price.lines.map((line) => ({ label: LINE_LABEL[line.kind], amount: money(line.amount) })),
        payAtHotel: offer.price.dueAtProperty.map((due) => ({ label: DUE_LABEL[due.kind], amount: money(due.amount), localAmount: due.localAmount ? money(due.localAmount) : null })),
        freeCancellation: freeCancellation(offer, now) !== null,
        cancellation: cancellationSummary({ refundable: offer.refundable, cancelPenalties: offer.cancelPenalties, nonrefundableDateRanges: offer.nonrefundableDateRanges, price: { total: offer.price.total, nights: offer.price.nights } }, now).text,
      }));
    return {
      ok: true,
      data: {
        hotel: { hotelId, name: found.hotel.name, stars: stars(found.hotel.starRating), area: found.hotel.city },
        checkin: summary.checkin,
        checkout: summary.checkout,
        nights: summary.nights,
        rates,
        openInApolles: hotelLink(appBase(deps), searchId, hotelId),
        note: NOTE,
      },
    };
  } catch (error) {
    return failure(error);
  }
}
