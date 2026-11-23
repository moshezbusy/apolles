import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { getContent } from "@/server/content/content-cache";
import { db } from "@/server/db";
import { freeCancellation } from "@/lib/cancellation";
import { hitRateLimit } from "@/server/rate-limit";
import { SupplierError, SupplierRequestRejected } from "@/server/supplier/expedia/client";
import { multiRoomAllowed, supplierAdapter } from "@/server/supplier";
import { feesAtProperty } from "@/server/supplier/price";
import type { Image, Occupancy, Offer, PropertyContent, SupplierAdapter, SupplierContext } from "@/server/supplier/types";
import type { Money } from "@/lib/supplier-money";
import { SEVERAL_ROOMS_UNAVAILABLE, SearchInputInvalid, SearchRateLimited, SearchUnavailable } from "./errors";
import { hotelDestination } from "./destinations";
import { MAX_ROOMS, type SearchInput, searchInputSchema } from "./input";

// Hotel search (plan 2b, task 6; spec section 3 rows 4-6).
// - startSearch picks the destination's active, Expedia-collect hotels in rank order and asks
//   Expedia for the first 250; loadMore asks for the next 250.
// - Results are stored as a snapshot for 30 minutes: filters, sorting and paging read it and never
//   call Expedia again. The price is checked again before booking (plan 3).
// - The point-of-sale country is the agency's, read from the database (TR2).
// - Every read and write is scoped by the session's agencyId: another agency's id gives null.
// - Supplier failures become SearchUnavailable (screen 24); no retry inside the request (TR7).
//   A search the supplier refuses as asked (HTTP 400: dates or guests it does not take) is not an
//   outage: it becomes SearchInputInvalid, "Check the dates and guests and search again."
// - Limits are per user, so one agent's searching never locks out a colleague; a higher ceiling
//   per agency stays as a backstop. Stored searches are counted and removed per user too.

const BATCH = 250;
const MAX_CANDIDATES = 5_000;
const SNAPSHOT_TTL_MS = 30 * 60_000;
const CLEANUP_AFTER_MS = 60 * 60_000;
const SEARCH_RATE_LIMIT = { limit: 30, windowMs: 60_000 }; // searches and load-more, per user
const SEARCH_AGENCY_CEILING = { limit: 150, windowMs: 60_000 }; // all the agency's users together
const HOTEL_RATE_LIMIT = { limit: 120, windowMs: 60_000 }; // hotel pages, per user
const HOTEL_AGENCY_CEILING = { limit: 600, windowMs: 60_000 };
const DEFAULT_TAKE = 20;
const MAX_TAKE = 50;
// Older searches are removed, so nobody can fill the database: 50 per user, and 300 per agency
// as a backstop. Expired searches go first, then the oldest; one younger than 5 minutes is never
// removed (it is a search somebody is looking at right now).
const MAX_SNAPSHOTS_PER_USER = 50;
const MAX_SNAPSHOTS_PER_AGENCY = 300;
const KEEP_YOUNGER_THAN_MS = 5 * 60_000;
const REJECTED = "Check the dates and guests and search again.";

export type SearchContext = { agencyId: string; userId: string; supplierContext: SupplierContext };
type Deps = { adapter?: SupplierAdapter; now?: Date; content?: typeof getContent };

export type HotelCard = {
  propertyId: string;
  name: string;
  city: string;
  starRating: string | null;
  minTotal: Money;
  refundableAvailable: boolean;
  feesAtProperty: boolean; // the shown rate has something to pay at the hotel (BP4)
  heroImage: Image | null;
  // The rate behind the shown price, for "Book this room" / "Add to quote" on the card (plan 8d-3).
  // Without the price-check tokens: those stay on the server. Null if the stored offers do not read.
  best: { offer: CardOffer; otherRates: number } | null;
};

export type CardOffer = Omit<Offer, "bedGroups"> & { bedGroups: { id: string; description: string }[] };

export type ListOptions = {
  sort: "recommended" | "price_asc" | "price_desc" | "stars_desc";
  minPriceMinor?: number;
  maxPriceMinor?: number;
  stars?: number[];
  name?: string;
  roomName?: string;
  freeCancellation?: boolean;
  cursor?: string;
  take?: number;
};

// The search as stored with its snapshot: the rooms in order (plan 10). A search stored before
// plan 10 has one room's guests at the top (adults, childAges); roomsOfQuery reads both. A search
// of one hotel (chosen by name, or booking from a quote) also names the hotel (propertyId).
const storedRoom = z.object({ adults: z.number().int(), childAges: z.array(z.number().int()) });
const storedQuery = z
  .object({
    destinationId: z.string(),
    checkin: z.string(),
    checkout: z.string(),
    rooms: z.array(storedRoom).min(1).max(MAX_ROOMS).optional(),
    adults: z.number().int().optional(),
    childAges: z.array(z.number().int()).optional(),
    countryCode: z.string(),
    propertyId: z.string().optional(),
  })
  .refine((q) => q.rooms !== undefined || (q.adults !== undefined && q.childAges !== undefined));
export type StoredQuery = z.infer<typeof storedQuery>;
type NewQuery = SearchInput & { countryCode: string; propertyId?: string };

export function roomsOfQuery(query: StoredQuery): Occupancy[] {
  return query.rooms ?? [{ adults: query.adults ?? 0, childAges: query.childAges ?? [] }];
}

// The stored search read back, with the totals over every room for the callers that count
// guests (booking, quotes) as well as the rooms themselves.
export type SnapshotQuery = { destinationId: string; checkin: string; checkout: string; countryCode: string; adults: number; childAges: number[] };

function readQuery(raw: unknown): { query: SnapshotQuery; rooms: Occupancy[] } | null {
  const parsed = storedQuery.safeParse(raw);
  if (!parsed.success) return null;
  const { destinationId, checkin, checkout, countryCode } = parsed.data;
  const rooms = roomsOfQuery(parsed.data);
  return {
    query: { destinationId, checkin, checkout, countryCode, adults: rooms.reduce((n, r) => n + r.adults, 0), childAges: rooms.flatMap((r) => r.childAges) },
    rooms,
  };
}

// 1 to 8 rooms, and more than one only while multiRoomAllowed (plan 10). Checked before the
// supplier is asked; the adapter's own check is only a backstop.
function checkRooms(rooms: Occupancy[]): void {
  if (rooms.length < 1 || rooms.length > MAX_ROOMS) throw new SearchInputInvalid("Check the destination, dates and guests.");
  if (rooms.length > 1 && !multiRoomAllowed()) throw new SearchInputInvalid(SEVERAL_ROOMS_UNAVAILABLE);
}

// Offers are read back from the database before the hotel page and booking use them: a damaged
// or old-format row gives "not found", never a half-read price.
const money = z.object({ minor: z.number().int(), currency: z.string().regex(/^[A-Z]{3}$/) }).strict();
const priceSchema = z
  .object({
    total: money,
    lines: z.array(
      z
        .object({
          kind: z.enum(["room_rate", "extra_person_fee", "taxes_and_fees", "taxes", "discount", "service_fee"]),
          amount: money,
        })
        .strict(),
    ),
    dueAtProperty: z.array(
      z.object({ kind: z.enum(["mandatory_fee", "resort_fee", "mandatory_tax"]), amount: money, localAmount: money.nullable() }).strict(),
    ),
    dueAtPropertyTotal: money.nullable(),
    nights: z.number().int().positive(),
  })
  .strict();
const offerSchema: z.ZodType<Offer> = z
  .object({
    propertyId: z.string(),
    roomId: z.string(),
    roomName: z.string(),
    rateId: z.string(),
    refundable: z.boolean(),
    bedGroups: z.array(z.object({ id: z.string(), description: z.string(), priceCheckToken: z.string() }).strict()),
    cancelPenalties: z.array(
      z
        .object({ start: z.string(), end: z.string(), amount: money.nullable(), nights: z.number().int().nullable(), percent: z.string().nullable() })
        .strict(),
    ),
    nonrefundableDateRanges: z.array(z.object({ start: z.string(), end: z.string() }).strict()),
    // Plan 8f: a search stored before this field reads as "nothing listed".
    amenities: z.array(z.string().max(100)).max(10).default([]),
    price: priceSchema,
    // Plan 10: a search stored before rooms were counted is one room at the offer's price.
    roomPrices: z.array(priceSchema).min(1).max(8).optional(),
  })
  .strict()
  .transform(({ roomPrices, ...offer }) => ({ ...offer, roomPrices: roomPrices ?? [offer.price] }));
const storedOffers = z.array(offerSchema).min(1);

// Plan 10: an offer is priced for every room of its search, one price per room, and the rooms'
// prices add up to the offer's price (same currency and nights, totals summing exactly).
function pricedForRooms(offer: Offer, rooms: Occupancy[]): boolean {
  if (offer.roomPrices.length !== rooms.length) return false;
  const { total, nights } = offer.price;
  let sum = 0;
  for (const room of offer.roomPrices) {
    if (room.total.currency !== total.currency || room.nights !== nights) return false;
    sum += room.total.minor;
  }
  return Number.isSafeInteger(sum) && sum === total.minor;
}

// A hotel's stored offers, read back. Offers that do not fit the rooms are dropped before they
// are stored (fetchBatch), so one here is a damaged row: it gives nothing for the hotel, never
// a price to show or book (and the rate positions of the results stay as stored).
function readOffers(raw: unknown, rooms: Occupancy[]): Offer[] | null {
  const offers = storedOffers.safeParse(raw);
  if (!offers.success) return null;
  return offers.data.every((offer) => pricedForRooms(offer, rooms)) ? offers.data : null;
}

// The user's own limit first: an agent over it is refused without using up the agency's ceiling,
// so one busy agent cannot lock out the others.
async function limitPerUser(
  action: "search" | "hotel",
  who: { agencyId: string; userId: string },
  perUser: { limit: number; windowMs: number },
  perAgency: { limit: number; windowMs: number },
  message: string,
): Promise<void> {
  const user = await hitRateLimit(`${action}:user:${who.userId}`, perUser.limit, perUser.windowMs);
  if (!user.allowed) throw new SearchRateLimited(message);
  const agency = await hitRateLimit(`${action}:agency:${who.agencyId}`, perAgency.limit, perAgency.windowMs);
  if (!agency.allowed) throw new SearchRateLimited(message);
}

async function rateLimit(who: { agencyId: string; userId: string }): Promise<void> {
  await limitPerUser("search", who, SEARCH_RATE_LIMIT, SEARCH_AGENCY_CEILING, "Too many searches. Wait a minute and try again.");
}

type BatchSnapshot = { id: string; candidateIds: string[]; nextIndex: number; query: { checkin: string; checkout: string; countryCode: string }; rooms: Occupancy[] };

// Asks Expedia for the next batch of a snapshot's candidates and stores the priced hotels.
async function fetchBatch(snapshot: BatchSnapshot, supplierContext: SupplierContext, adapter: SupplierAdapter, now: Date): Promise<number> {
  checkRooms(snapshot.rooms);
  const batch = snapshot.candidateIds.slice(snapshot.nextIndex, snapshot.nextIndex + BATCH);
  if (batch.length === 0) return 0;
  const end = snapshot.nextIndex + batch.length;
  // Claim the batch first: of two load-more clicks at the same moment only one moves nextIndex
  // and asks Expedia; the other gets 0. Any failure after the claim (the supplier, or the
  // database while the answer is stored) gives the claim back, so these hotels are asked for
  // again on the next try instead of being skipped for good.
  const claimed = await db.searchSnapshot.updateMany({ where: { id: snapshot.id, nextIndex: snapshot.nextIndex }, data: { nextIndex: end } });
  if (claimed.count === 0) return 0;
  try {
    await storeBatch(snapshot, batch, supplierContext, adapter, now);
  } catch (error) {
    try {
      await db.searchSnapshot.updateMany({ where: { id: snapshot.id, nextIndex: end }, data: { nextIndex: snapshot.nextIndex } });
    } catch {
      console.error("search batch claim could not be given back"); // the first error is the one to report
    }
    // The supplier refused the search as asked (HTTP 400): not an outage, and trying again
    // later would not help. Anything else from the supplier is "unavailable right now".
    if (error instanceof SupplierRequestRejected) throw new SearchInputInvalid(REJECTED);
    if (error instanceof SupplierError) throw new SearchUnavailable("Hotel search is unavailable right now. Try again in a few minutes.");
    throw error;
  }
  return batch.length;
}

async function storeBatch(snapshot: BatchSnapshot, batch: string[], supplierContext: SupplierContext, adapter: SupplierAdapter, now: Date): Promise<void> {
  const results = await adapter.searchAvailability(
    {
      propertyIds: batch,
      checkin: snapshot.query.checkin,
      checkout: snapshot.query.checkout,
      occupancies: snapshot.rooms,
      countryCode: snapshot.query.countryCode,
    },
    supplierContext,
  );

  const asked = new Set(batch);
  const byId = new Map<string, Offer[]>();
  for (const property of results) {
    if (!asked.has(property.propertyId) || byId.has(property.propertyId)) continue; // stranger or duplicate
    // An offer of another hotel, or not priced for exactly the rooms asked, is dropped.
    const offers = property.offers.filter((offer) => offer.propertyId === property.propertyId && pricedForRooms(offer, snapshot.rooms));
    if (offers.length > 0) byId.set(property.propertyId, offers);
  }

  const properties = await db.property.findMany({
    where: { id: { in: [...byId.keys()] } },
    select: { id: true, name: true, city: true, starRating: true },
  });
  const positions = new Map(snapshot.candidateIds.map((id, i) => [id, i]));
  const rows = properties.flatMap((property) => {
    const offers = byId.get(property.id);
    if (!offers) return [];
    const cheapest = offers.reduce((min, offer) => (offer.price.total.minor < min.price.total.minor ? offer : min));
    return [
      {
        snapshotId: snapshot.id,
        propertyId: property.id,
        position: positions.get(property.id) ?? 0,
        name: property.name,
        city: property.city,
        starRating: property.starRating,
        minTotalMinor: cheapest.price.total.minor,
        currency: cheapest.price.total.currency,
        refundableAvailable: offers.some((offer) => freeCancellation(offer, now) !== null),
        offers: offers as unknown as Prisma.InputJsonValue,
      },
    ];
  });

  // One row per rate as well, so the results filters can match a single rate (see listResults).
  // Free cancellation follows the one rule (src/lib/cancellation.ts), the same as the label and
  // the booking's deadline: the supplier's "refundable" alone is never enough.
  const rates = rows.flatMap((row) =>
    (byId.get(row.propertyId) ?? []).map((offer, rateIndex) => {
      const free = freeCancellation(offer, now);
      return {
        snapshotId: snapshot.id,
        propertyId: row.propertyId,
        rateIndex,
        roomName: offer.roomName.toLowerCase().slice(0, 300),
        refundable: free !== null,
        freeCancelUntil: free?.at ?? null,
        totalMinor: offer.price.total.minor,
        currency: offer.price.total.currency,
        feesAtProperty: feesAtProperty(offer.price).due,
      };
    }),
  );
  await db.$transaction([
    db.searchHotel.createMany({ data: rows, skipDuplicates: true }),
    db.searchRate.createMany({ data: rates, skipDuplicates: true }),
  ]);
}

// Best effort: cache the content (images) of the priced hotels so the results page can show
// them. A failure here never fails the search.
async function prefetchContent(snapshotId: string, content: typeof getContent, now: Date): Promise<void> {
  try {
    const hotels = await db.searchHotel.findMany({ where: { snapshotId }, select: { propertyId: true } });
    if (hotels.length > 0) await content(hotels.map((h) => h.propertyId), now);
  } catch (error) {
    console.error(`search content prefetch failed: ${error instanceof Error ? error.name : "Error"}`);
  }
}

export async function startSearch(ctx: SearchContext, rawInput: unknown, deps: Deps = {}): Promise<{ snapshotId: string }> {
  const now = deps.now ?? new Date();
  const parsed = searchInputSchema(now).safeParse(rawInput);
  if (!parsed.success) throw new SearchInputInvalid("Check the destination, dates and guests.");
  const input: SearchInput = parsed.data;
  checkRooms(input.rooms);
  await rateLimit(ctx);

  const [agency, destination] = await Promise.all([
    db.agency.findUnique({ where: { id: ctx.agencyId }, select: { country: true } }),
    db.destination.findFirst({ where: { id: input.destinationId, active: true }, select: { id: true } }),
  ]);
  if (!agency) throw new Error("startSearch: agency not found");
  if (!destination) throw new SearchInputInvalid("Choose a destination from the list.");

  const candidates = await db.$queryRaw<{ id: string }[]>`
    SELECT p."id" FROM "DestinationProperty" dp
    JOIN "Property" p ON p."id" = dp."propertyId"
    WHERE dp."destinationId" = ${destination.id} AND p."active" AND p."expediaCollect"
    ORDER BY p."rank" ASC NULLS LAST, p."id" ASC
    LIMIT ${MAX_CANDIDATES}`;

  return createSnapshot(ctx, { ...input, countryCode: agency.country }, candidates.map((c) => c.id), now, deps);
}

// Plan 5d, "Book this room" on a quote: a search of the one hotel the quote names, for the quote's
// destination, dates and guests, so the room's rate can be found and its price checked again. Same
// checks and the same rate limit as a destination search. Also "Search again" of a stored search
// of one hotel (the same hotel under the same destination). `priced`: the hotel has rooms.
export async function searchOneHotel(
  ctx: SearchContext,
  rawInput: { destinationId: string; propertyId: string; checkin: string; checkout: string; rooms: Occupancy[] },
  deps: Deps = {},
): Promise<{ snapshotId: string; priced: boolean }> {
  const now = deps.now ?? new Date();
  const { propertyId, ...rest } = rawInput;
  const parsed = searchInputSchema(now).safeParse(rest);
  if (!parsed.success || typeof propertyId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(propertyId)) {
    throw new SearchInputInvalid("Check the destination, dates and guests.");
  }
  checkRooms(parsed.data.rooms);
  await rateLimit(ctx);
  const [agency, property] = await Promise.all([
    db.agency.findUnique({ where: { id: ctx.agencyId }, select: { country: true } }),
    db.property.findFirst({ where: { id: propertyId, active: true, expediaCollect: true }, select: { id: true } }),
  ]);
  if (!agency) throw new Error("searchOneHotel: agency not found");
  if (!property) throw new SearchInputInvalid(HOTEL_GONE);
  const { snapshotId } = await createSnapshot(ctx, { ...parsed.data, countryCode: agency.country, propertyId: property.id }, [property.id], now, deps);
  return { snapshotId, priced: (await db.searchHotel.count({ where: { snapshotId, propertyId: property.id } })) > 0 };
}

const HOTEL_GONE = "This hotel can no longer be booked. Choose another hotel.";
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

// A hotel chosen by name in the search box (or "Search again" of such a search): a search of that
// one hotel, with the same date and guest rules, the same rate limit and the same ownership as a
// destination search. The browser sends only the hotel, the dates and the rooms; the destination
// the search is stored under is the hotel's own, read here. `priced`: the hotel has rooms for the
// dates (its page can open straight away).
export async function startHotelSearch(
  ctx: SearchContext,
  rawInput: unknown,
  deps: Deps = {},
): Promise<{ snapshotId: string; propertyId: string; priced: boolean }> {
  if (typeof rawInput !== "object" || rawInput === null || Object.hasOwn(rawInput, "destinationId")) {
    throw new SearchInputInvalid("Check the hotel, dates and guests.");
  }
  const { propertyId, ...rest } = rawInput as Record<string, unknown>;
  if (typeof propertyId !== "string" || !SAFE_ID.test(propertyId)) throw new SearchInputInvalid("Check the hotel, dates and guests.");
  // The dates and guests first, so a bad request costs no lookup (searchOneHotel checks them again).
  if (!searchInputSchema(deps.now ?? new Date()).safeParse({ ...rest, destinationId: "x" }).success) {
    throw new SearchInputInvalid("Check the hotel, dates and guests.");
  }
  const destinationId = await hotelDestination(propertyId);
  if (!destinationId) throw new SearchInputInvalid(HOTEL_GONE);
  const input = rest as { checkin: string; checkout: string; rooms: Occupancy[] };
  return { ...(await searchOneHotel(ctx, { ...input, destinationId, propertyId }, deps)), propertyId };
}

async function createSnapshot(
  ctx: SearchContext,
  query: NewQuery,
  candidateIds: string[],
  now: Date,
  deps: Deps,
): Promise<{ snapshotId: string }> {
  const candidates = candidateIds.map((id) => ({ id }));
  const snapshot = await db.searchSnapshot.create({
    data: {
      agencyId: ctx.agencyId,
      userId: ctx.userId,
      query,
      candidateIds: candidates.map((c) => c.id),
      createdAt: now,
      expiresAt: new Date(now.getTime() + SNAPSHOT_TTL_MS),
    },
  });
  await removeOldSnapshots(ctx, now);
  if (candidates.length > 0) {
    await fetchBatch({ ...snapshot, query, rooms: query.rooms }, ctx.supplierContext, deps.adapter ?? supplierAdapter(), now);
    await prefetchContent(snapshot.id, deps.content ?? getContent, now);
  }
  return { snapshotId: snapshot.id };
}

type StoredSearch = { id: string; createdAt: Date; expiresAt: Date };

// Which stored searches to remove so that at most `max` stay: expired ones first, then the
// oldest. One younger than 5 minutes is never chosen, even if that leaves more than `max`.
export function snapshotsToRemove(rows: StoredSearch[], max: number, now: Date): string[] {
  const excess = rows.length - max;
  if (excess <= 0) return [];
  const expired = (row: StoredSearch) => row.expiresAt.getTime() <= now.getTime();
  return rows
    .filter((row) => now.getTime() - row.createdAt.getTime() >= KEEP_YOUNGER_THAN_MS)
    .sort((a, b) => Number(expired(b)) - Number(expired(a)) || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
    .slice(0, excess)
    .map((row) => row.id);
}

// Keeps the stored searches within the limits: the user's own first (a colleague's searches are
// never removed to make room for this user's), then the agency's backstop.
async function removeOldSnapshots(ctx: { agencyId: string; userId: string }, now: Date): Promise<void> {
  const select = { id: true, createdAt: true, expiresAt: true } as const;
  const own = await db.searchSnapshot.findMany({ where: { agencyId: ctx.agencyId, userId: ctx.userId }, select });
  const ownOld = snapshotsToRemove(own, MAX_SNAPSHOTS_PER_USER, now);
  if (ownOld.length > 0) await db.searchSnapshot.deleteMany({ where: { agencyId: ctx.agencyId, userId: ctx.userId, id: { in: ownOld } } });
  if ((await db.searchSnapshot.count({ where: { agencyId: ctx.agencyId } })) <= MAX_SNAPSHOTS_PER_AGENCY) return;
  const all = await db.searchSnapshot.findMany({ where: { agencyId: ctx.agencyId }, select, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 5_000 });
  const old = snapshotsToRemove(all, MAX_SNAPSHOTS_PER_AGENCY, now);
  if (old.length > 0) await db.searchSnapshot.deleteMany({ where: { agencyId: ctx.agencyId, id: { in: old } } });
}

async function ownSnapshot(agencyId: string, snapshotId: string) {
  if (typeof snapshotId !== "string" || snapshotId.length > 64) return null;
  return db.searchSnapshot.findFirst({ where: { id: snapshotId, agencyId } });
}

export async function loadMore(ctx: SearchContext, snapshotId: string, deps: Deps = {}): Promise<{ added: number; hasMore: boolean } | null> {
  const now = deps.now ?? new Date();
  const snapshot = await ownSnapshot(ctx.agencyId, snapshotId);
  if (!snapshot || snapshot.expiresAt <= now) return null;
  const read = readQuery(snapshot.query);
  if (!read) throw new Error("loadMore: stored search query does not read");
  if (snapshot.nextIndex >= snapshot.candidateIds.length) return { added: 0, hasMore: false };
  checkRooms(read.rooms); // before the rate limit, as the other entry points
  await rateLimit(ctx);
  const added = await fetchBatch({ ...snapshot, ...read }, ctx.supplierContext, deps.adapter ?? supplierAdapter(), now);
  await prefetchContent(snapshot.id, deps.content ?? getContent, now);
  return { added, hasMore: snapshot.nextIndex + added < snapshot.candidateIds.length };
}

function orderSql(sort: ListOptions["sort"]): Prisma.Sql {
  switch (sort) {
    case "price_asc":
      return Prisma.sql`m."totalMinor" ASC, h."position" ASC`;
    case "price_desc":
      return Prisma.sql`m."totalMinor" DESC, h."position" ASC`;
    case "stars_desc":
      return Prisma.sql`h."starRating" DESC NULLS LAST, h."position" ASC`;
    default:
      return Prisma.sql`h."position" ASC`;
  }
}

// A LIKE pattern that matches the text anywhere, with its own wildcards taken literally.
function containsPattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

type ResultRow = {
  propertyId: string;
  name: string;
  city: string;
  starRating: string | null;
  totalMinor: number;
  currency: string;
  feesAtProperty: boolean;
  anyRefundable: boolean;
  rateIndex: number;
};

export async function listResults(
  agencyId: string,
  snapshotId: string,
  opts: ListOptions,
  now: Date = new Date(),
): Promise<{
  hotels: HotelCard[];
  total: number;
  nextCursor: string | null;
  hasMoreFromSupplier: boolean;
  // How far the search got: `loaded` of the destination's `candidates` hotels were asked for so
  // far (250 at a time), so the page can say "the first N of M hotels" while more remain.
  loaded: number;
  candidates: number;
  expired: boolean;
} | null> {
  const snapshot = await ownSnapshot(agencyId, snapshotId);
  if (!snapshot) return null;
  const candidates = snapshot.candidateIds.length;
  const loaded = Math.min(snapshot.nextIndex, candidates);
  if (snapshot.expiresAt <= now) return { hotels: [], total: 0, nextCursor: null, hasMoreFromSupplier: false, loaded, candidates, expired: true };

  const take = Math.min(Math.max(1, Math.trunc(opts.take ?? DEFAULT_TAKE)), MAX_TAKE);
  const skip = opts.cursor && /^\d{1,6}$/.test(opts.cursor) ? Number(opts.cursor) : 0;
  // Rate filters (room name, free cancellation, price) must all hold for one rate; the hotel
  // then shows its cheapest such rate. Hotel filters (name, stars) apply to the hotel.
  const rateWhere: Prisma.Sql[] = [Prisma.sql`r."snapshotId" = ${snapshot.id}`];
  const roomName = opts.roomName?.trim().slice(0, 100).toLowerCase();
  if (roomName) rateWhere.push(Prisma.sql`r."roomName" LIKE ${containsPattern(roomName)} ESCAPE '\\'`);
  // Free cancellation still ahead at this moment (the stored deadline against the clock): a
  // deadline that passed since the search ran no longer counts. Both are UTC wall-clock times.
  const clock = now.toISOString().slice(0, 23);
  const freeNow = Prisma.sql`(r."freeCancelUntil" IS NOT NULL AND r."freeCancelUntil" > ${clock}::timestamp)`;
  if (opts.freeCancellation) rateWhere.push(freeNow);
  if (opts.minPriceMinor !== undefined) rateWhere.push(Prisma.sql`r."totalMinor" >= ${Math.trunc(opts.minPriceMinor)}`);
  if (opts.maxPriceMinor !== undefined) rateWhere.push(Prisma.sql`r."totalMinor" <= ${Math.trunc(opts.maxPriceMinor)}`);
  const hotelWhere: Prisma.Sql[] = [Prisma.sql`m."rn" = 1`];
  const name = opts.name?.trim().slice(0, 100);
  if (name) hotelWhere.push(Prisma.sql`h."name" ILIKE ${containsPattern(name)} ESCAPE '\\'`);
  const stars = (opts.stars ?? []).filter((s) => Number.isInteger(s) && s >= 0 && s <= 5);
  if (stars.length > 0) {
    // Whole-star match: a 4.5 hotel counts as 4. A hotel with no rating matches no star filter.
    hotelWhere.push(Prisma.sql`(${Prisma.join(stars.map((s) => Prisma.sql`(h."starRating" >= ${s} AND h."starRating" < ${s + 1})`), " OR ")})`);
  }
  const matched = Prisma.sql`
    WITH m AS (
      SELECT r."propertyId", r."totalMinor", r."currency", r."feesAtProperty",
             r."rateIndex",
             bool_or(${freeNow}) OVER (PARTITION BY r."propertyId") AS "anyRefundable",
             row_number() OVER (PARTITION BY r."propertyId" ORDER BY r."totalMinor" ASC, r."rateIndex" ASC) AS "rn"
      FROM "SearchRate" r
      WHERE ${Prisma.join(rateWhere, " AND ")}
    )`;
  const from = Prisma.sql`FROM m JOIN "SearchHotel" h ON h."snapshotId" = ${snapshot.id} AND h."propertyId" = m."propertyId"
    WHERE ${Prisma.join(hotelWhere, " AND ")}`;
  const [rows, counted] = await Promise.all([
    db.$queryRaw<ResultRow[]>`${matched}
      SELECT h."propertyId", h."name", h."city", h."starRating"::text AS "starRating",
             m."totalMinor", m."currency", m."feesAtProperty", m."anyRefundable", m."rateIndex"
      ${from}
      ORDER BY ${orderSql(opts.sort)}
      OFFSET ${skip} LIMIT ${take + 1}`,
    db.$queryRaw<{ count: bigint }[]>`${matched} SELECT count(*) AS "count" ${from}`,
  ]);
  const total = Number(counted[0]?.count ?? 0);
  const page = rows.slice(0, take);

  // Images from the content cache only: listing results never calls Expedia.
  const ids = page.map((r) => r.propertyId);
  const [cached, stored] = await Promise.all([
    db.propertyContentCache.findMany({ where: { propertyId: { in: ids } }, select: { propertyId: true, data: true } }),
    db.searchHotel.findMany({ where: { snapshotId: snapshot.id, propertyId: { in: ids } }, select: { propertyId: true, offers: true } }),
  ]);
  const offersById = new Map(stored.map((h) => [h.propertyId, h.offers]));
  const rooms = readQuery(snapshot.query)?.rooms;
  const bestOf = (row: ResultRow): HotelCard["best"] => {
    const offers = rooms ? readOffers(offersById.get(row.propertyId), rooms) : null;
    const offer = offers?.[row.rateIndex];
    if (!offers || !offer || offer.bedGroups.length === 0) return null;
    return {
      offer: { ...offer, bedGroups: offer.bedGroups.map((b) => ({ id: b.id, description: b.description })) },
      // Every other rate of the hotel, as its page lists them (that page has its own filters).
      otherRates: offers.length - 1,
    };
  };
  const heroById = new Map(
    cached.map((c) => {
      const hero = (c.data as { heroImage?: unknown } | null)?.heroImage;
      const ok = hero && typeof hero === "object" && typeof (hero as Image).url === "string" && (hero as Image).url.startsWith("https://");
      return [c.propertyId, ok ? (hero as Image) : null];
    }),
  );

  return {
    hotels: page.map((row) => ({
      propertyId: row.propertyId,
      name: row.name,
      city: row.city,
      starRating: row.starRating?.toString() ?? null,
      minTotal: { minor: row.totalMinor, currency: row.currency },
      refundableAvailable: row.anyRefundable,
      feesAtProperty: row.feesAtProperty,
      heroImage: heroById.get(row.propertyId) ?? null,
      best: bestOf(row),
    })),
    total,
    nextCursor: rows.length > take ? String(skip + take) : null,
    hasMoreFromSupplier: snapshot.nextIndex < snapshot.candidateIds.length,
    loaded,
    candidates,
    expired: false,
  };
}

// What the results and hotel pages show above the list: the search as the agent entered it.
export type SearchSummary = {
  destinationId: string;
  destinationLabel: string;
  checkin: string;
  checkout: string;
  nights: number;
  rooms: Occupancy[]; // in room order (plan 10)
  adults: number; // over all rooms
  childAges: number[]; // over all rooms, in room order
  // A search of one hotel: the hotel, and its name as destinationLabel (null: a destination search).
  propertyId: string | null;
  expired: boolean;
};

export async function searchSummary(agencyId: string, snapshotId: string, now: Date = new Date()): Promise<SearchSummary | null> {
  const snapshot = await ownSnapshot(agencyId, snapshotId);
  if (!snapshot) return null;
  const read = readQuery(snapshot.query);
  if (!read) return null;
  const q = read.query;
  const propertyId = storedQuery.safeParse(snapshot.query).data?.propertyId ?? null;
  const label = propertyId
    ? (await db.property.findUnique({ where: { id: propertyId }, select: { name: true } }))?.name
    : (await db.destination.findUnique({ where: { id: q.destinationId }, select: { nameFull: true } }))?.nameFull;
  return {
    destinationId: q.destinationId,
    destinationLabel: label ?? "",
    checkin: q.checkin,
    checkout: q.checkout,
    nights: Math.round((Date.parse(`${q.checkout}T00:00:00Z`) - Date.parse(`${q.checkin}T00:00:00Z`)) / 86_400_000),
    rooms: read.rooms,
    adults: q.adults,
    childAges: q.childAges,
    propertyId,
    expired: snapshot.expiresAt <= now,
  };
}

export async function getHotelOffers(
  who: { agencyId: string; userId: string },
  snapshotId: string,
  propertyId: string,
  now: Date = new Date(),
  deps: { content?: typeof getContent } = {},
): Promise<{ offers: Offer[]; content: PropertyContent | null; hotel: { name: string; city: string; starRating: string | null } } | null> {
  await limitPerUser("hotel", who, HOTEL_RATE_LIMIT, HOTEL_AGENCY_CEILING, "Too many hotel pages opened. Wait a minute and try again.");
  const snapshot = await ownSnapshot(who.agencyId, snapshotId);
  if (!snapshot || snapshot.expiresAt <= now) return null;
  if (typeof propertyId !== "string" || propertyId.length > 64) return null;
  const read = readQuery(snapshot.query);
  if (!read) return null;
  const hotel = await db.searchHotel.findUnique({ where: { snapshotId_propertyId: { snapshotId: snapshot.id, propertyId } } });
  if (!hotel) return null;
  const offers = readOffers(hotel.offers, read.rooms);
  if (!offers) return null;
  // Content (photos, policies) is best effort: without it the page still shows the rates.
  let content: PropertyContent | null = null;
  try {
    content = (await (deps.content ?? getContent)([propertyId], now)).get(propertyId) ?? null;
  } catch (error) {
    console.error(`hotel content failed: ${error instanceof Error ? error.name : "Error"}`);
  }
  return {
    offers,
    content,
    hotel: { name: hotel.name, city: hotel.city, starRating: hotel.starRating?.toString() ?? null },
  };
}

// The name of one rate in links and forms ("r"): the room id and the rate id together, because a
// rate id alone can repeat across a hotel's rooms. findOffer reads it back; a plain rate id (a
// link made before this, or a caller that only knows the rate) still works as before.
const REF_SEPARATOR = "~";
const MAX_REF_LENGTH = 128; // what the booking and quote forms accept for "r"

export function offerRef(offer: Pick<Offer, "roomId" | "rateId">): string {
  const ref = `${offer.roomId}${REF_SEPARATOR}${offer.rateId}`;
  return ref.length <= MAX_REF_LENGTH ? ref : offer.rateId;
}

function offerByRef(offers: Offer[], ref: string): Offer | undefined {
  const at = ref.indexOf(REF_SEPARATOR);
  if (at > 0) {
    const [roomId, rateId] = [ref.slice(0, at), ref.slice(at + 1)];
    const exact = offers.find((o) => o.roomId === roomId && o.rateId === rateId);
    if (exact) return exact;
  }
  return offers.find((o) => o.rateId === ref);
}

// One rate of one hotel of the agency's own, unexpired search, for the booking pages. Everything
// a booking needs is read here on the server; the browser only names the rate (rateId: an
// offerRef, or a plain rate id).
export async function findOffer(
  agencyId: string,
  ref: { snapshotId: string; propertyId: string; rateId: string; bedGroupId: string },
  now: Date = new Date(),
): Promise<{ offer: Offer; bedGroup: Offer["bedGroups"][number]; hotel: { name: string; city: string }; query: SnapshotQuery; rooms: Occupancy[] } | null> {
  for (const value of Object.values(ref)) if (typeof value !== "string" || value.length === 0 || value.length > 128) return null;
  const snapshot = await ownSnapshot(agencyId, ref.snapshotId);
  if (!snapshot || snapshot.expiresAt <= now) return null;
  const read = readQuery(snapshot.query);
  if (!read) return null;
  const hotel = await db.searchHotel.findUnique({ where: { snapshotId_propertyId: { snapshotId: snapshot.id, propertyId: ref.propertyId } } });
  if (!hotel) return null;
  const offers = readOffers(hotel.offers, read.rooms);
  if (!offers) return null;
  const offer = offerByRef(offers, ref.rateId);
  const bedGroup = offer?.bedGroups.find((b) => b.id === ref.bedGroupId);
  if (!offer || !bedGroup) return null;
  return { offer, bedGroup, hotel: { name: hotel.name, city: hotel.city }, query: read.query, rooms: read.rooms };
}

// Every rate of one hotel of the agency's own, unexpired search (no rate limit, no content): for
// finding the quoted room again when booking from a quote (plan 5d).
export async function snapshotOffers(agencyId: string, snapshotId: string, propertyId: string, now: Date = new Date()): Promise<Offer[]> {
  const snapshot = await ownSnapshot(agencyId, snapshotId);
  if (!snapshot || snapshot.expiresAt <= now) return [];
  const read = readQuery(snapshot.query);
  if (!read) return [];
  const hotel = await db.searchHotel.findUnique({ where: { snapshotId_propertyId: { snapshotId: snapshot.id, propertyId } } });
  return readOffers(hotel?.offers, read.rooms) ?? [];
}

// Deletes searches whose expiry passed more than an hour ago (their hotels go with them).
export async function cleanupSnapshots(now: Date = new Date()): Promise<number> {
  const result = await db.searchSnapshot.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - CLEANUP_AFTER_MS) } } });
  return result.count;
}
