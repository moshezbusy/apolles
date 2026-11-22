import { z } from "zod";
import { formatMinor } from "@/lib/supplier-money";
import { freeCancelEnds } from "@/server/booking/service";
import { getContent } from "@/server/content/content-cache";
import { suggestDestinations } from "@/server/search/destinations";
import { SearchInputInvalid, SearchRateLimited, SearchUnavailable } from "@/server/search/errors";
import { roomSchema } from "@/server/search/input";
import { getHotelOffers, listResults, startSearch } from "@/server/search/search";
import type { DueAtProperty, Offer, PriceBreakdown, SupplierAdapter } from "@/server/supplier/types";
import type { AssistantCaller } from "./connections";

// What an AI assistant may ask and get back (plan 2026-11-22-mcp-search-connector). Search
// only, through the same search service the agent's screens use, scoped by the token's agencyId.
// - Every output field is picked here by name: no price-check token, rate id, guest, client,
//   booking or balance data, and no supplier name (GR1). Package rates never exist here (the
//   adapter drops them, AP4).
// - Prices are the supplier's own totals, formatted without rounding (BP5). The average per night
//   is only given when it divides exactly.
// - Each hotel links to its page in Apolles (the agent's own search, 30 minutes), where the agent
//   checks the price again and books as usual.
// - No Customer-Ip is sent to the supplier: the request comes from the assistant's servers, and
//   the agent's IP is not known. Never a made-up one.

const MAX_HOTELS = 20;
const MAX_RATES = 30;

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: 400 | 404 | 429 | 503; error: string };
type Deps = { adapter?: SupplierAdapter; content?: typeof getContent; now?: Date; issuer: string };

const searchInput = z
  .object({
    destination: z.string().trim().min(2).max(60),
    checkin: z.string().max(10),
    checkout: z.string().max(10),
    rooms: z.array(roomSchema).min(1).max(8),
    sort: z.enum(["recommended", "price_asc", "price_desc", "stars_desc"]).optional(),
    freeCancellationOnly: z.boolean().optional(),
    maxResults: z.number().int().min(1).max(MAX_HOTELS).optional(),
  })
  .strict();

const ratesInput = z
  .object({
    searchId: z.string().min(1).max(64),
    hotelId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  })
  .strict();

const KIND_LABEL: Record<DueAtProperty["kind"], string> = { mandatory_fee: "mandatory fee", resort_fee: "resort fee", mandatory_tax: "mandatory tax" };

function money(m: { minor: number; currency: string }): string {
  return formatMinor(m.minor, m.currency);
}

function roomView(offer: Omit<Offer, "bedGroups"> & { bedGroups: { description: string }[] }) {
  const price: PriceBreakdown = offer.price;
  const taxes = price.lines.filter((l) => l.kind === "taxes_and_fees" || l.kind === "taxes");
  const taxCurrency = taxes[0]?.amount.currency;
  const sameCurrency = taxes.every((l) => l.amount.currency === taxCurrency);
  const taxMinor = taxes.reduce((n, l) => n + l.amount.minor, 0);
  const ends = freeCancelEnds(offer);
  return {
    roomName: offer.roomName,
    beds: offer.bedGroups.map((b) => b.description),
    included: offer.amenities, // e.g. meal plan, as the hotel lists it
    total: money(price.total), // the whole stay, all rooms, taxes included: paid in Apolles
    nights: price.nights,
    averagePerNight: price.total.minor % price.nights === 0 ? money({ minor: price.total.minor / price.nights, currency: price.total.currency }) : null,
    taxesAndFees: taxes.length > 0 && sameCurrency && taxCurrency ? money({ minor: taxMinor, currency: taxCurrency }) : null,
    payAtHotel: price.dueAtProperty.map((d) => ({ what: KIND_LABEL[d.kind], amount: money(d.amount), localAmount: d.localAmount ? money(d.localAmount) : null })),
    refundable: offer.refundable,
    freeCancellationUntil: ends ? ends.toISOString() : null,
  };
}

function mapError(error: unknown): ApiResult<never> {
  if (error instanceof SearchInputInvalid) return { ok: false, status: 400, error: error.message };
  if (error instanceof SearchRateLimited) return { ok: false, status: 429, error: error.message };
  if (error instanceof SearchUnavailable) return { ok: false, status: 503, error: error.message };
  throw error;
}

export type SearchAnswer = {
  searchId: string;
  destination: string;
  otherMatchingDestinations: string[];
  checkin: string;
  checkout: string;
  totalHotels: number;
  hotels: {
    hotelId: string;
    name: string;
    stars: string | null;
    area: string;
    fromTotal: string;
    freeCancellationAvailable: boolean;
    cheapestRoom: ReturnType<typeof roomView> | null;
    link: string;
  }[];
  note: string;
};

export async function assistantSearch(caller: AssistantCaller, raw: unknown, deps: Deps): Promise<ApiResult<SearchAnswer>> {
  const parsed = searchInput.safeParse(raw);
  if (!parsed.success) return { ok: false, status: 400, error: "Check the destination, dates (YYYY-MM-DD) and rooms." };
  const input = parsed.data;
  const now = deps.now ?? new Date();
  const matches = await suggestDestinations(input.destination, 5);
  const destination = matches[0];
  if (!destination) return { ok: false, status: 400, error: "No destination matches this name. Try the city name in English." };
  try {
    const ctx = { agencyId: caller.agencyId, userId: caller.userId, supplierContext: {} };
    const { snapshotId } = await startSearch(
      ctx,
      { destinationId: destination.id, checkin: input.checkin, checkout: input.checkout, rooms: input.rooms },
      { ...(deps.adapter ? { adapter: deps.adapter } : {}), ...(deps.content ? { content: deps.content } : {}), now },
    );
    const page = await listResults(
      caller.agencyId,
      snapshotId,
      { sort: input.sort ?? "recommended", ...(input.freeCancellationOnly ? { freeCancellation: true } : {}), take: input.maxResults ?? 10 },
      now,
    );
    if (!page) return { ok: false, status: 404, error: "The search was not found. Search again." };
    return {
      ok: true,
      data: {
        searchId: snapshotId,
        destination: destination.label,
        otherMatchingDestinations: matches.slice(1).map((m) => m.label),
        checkin: input.checkin,
        checkout: input.checkout,
        totalHotels: page.total,
        hotels: page.hotels.map((h) => ({
          hotelId: h.propertyId,
          name: h.name,
          stars: h.starRating,
          area: h.city,
          fromTotal: money(h.minTotal),
          freeCancellationAvailable: h.refundableAvailable,
          cheapestRoom: h.best ? roomView(h.best.offer) : null,
          link: `${deps.issuer}/search/${encodeURIComponent(snapshotId)}/hotels/${encodeURIComponent(h.propertyId)}`,
        })),
        note: "Prices are totals for the whole stay. To book, open the link in Apolles: the price is checked again there. This search stays open for 30 minutes.",
      },
    };
  } catch (error) {
    return mapError(error);
  }
}

export type RatesAnswer = {
  hotel: { hotelId: string; name: string; stars: string | null; area: string };
  rooms: ReturnType<typeof roomView>[];
  link: string;
};

export async function assistantRates(caller: AssistantCaller, raw: unknown, deps: Deps): Promise<ApiResult<RatesAnswer>> {
  const parsed = ratesInput.safeParse(raw);
  if (!parsed.success) return { ok: false, status: 400, error: "Give the searchId and hotelId from search_hotels." };
  const { searchId, hotelId } = parsed.data;
  try {
    const found = await getHotelOffers(caller.agencyId, searchId, hotelId, deps.now ?? new Date(), deps.content ? { content: deps.content } : {});
    if (!found) return { ok: false, status: 404, error: "This search has ended or the hotel is not in it. Search again." };
    return {
      ok: true,
      data: {
        hotel: { hotelId, name: found.hotel.name, stars: found.hotel.starRating, area: found.hotel.city },
        rooms: found.offers.slice(0, MAX_RATES).map(roomView),
        link: `${deps.issuer}/search/${encodeURIComponent(searchId)}/hotels/${encodeURIComponent(hotelId)}`,
      },
    };
  } catch (error) {
    return mapError(error);
  }
}
