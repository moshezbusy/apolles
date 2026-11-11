import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { getContent } from "@/server/content/content-cache";
import { db } from "@/server/db";
import { hitRateLimit } from "@/server/rate-limit";
import { SupplierError } from "@/server/supplier/expedia/client";
import { supplierAdapter } from "@/server/supplier";
import type { Image, Offer, PropertyContent, SupplierAdapter, SupplierContext } from "@/server/supplier/types";
import type { Money } from "@/lib/supplier-money";
import { SearchInputInvalid, SearchRateLimited, SearchUnavailable } from "./errors";
import { type SearchInput, searchInputSchema } from "./input";

// Hotel search (plan 2b, task 6; spec section 3 rows 4-6).
// - startSearch picks the destination's active, Expedia-collect hotels in rank order and asks
//   Expedia for the first 250; loadMore asks for the next 250.
// - Results are stored as a snapshot for 30 minutes: filters, sorting and paging read it and never
//   call Expedia again. The price is checked again before booking (plan 3).
// - The point-of-sale country is the agency's, read from the database (TR2).
// - Every read and write is scoped by the session's agencyId: another agency's id gives null.
// - Supplier failures become SearchUnavailable (screen 24); no retry inside the request (TR7).

const BATCH = 250;
const MAX_CANDIDATES = 5_000;
const SNAPSHOT_TTL_MS = 30 * 60_000;
const CLEANUP_AFTER_MS = 60 * 60_000;
const SEARCH_RATE_LIMIT = { limit: 30, windowMs: 60_000 }; // per agency
const HOTEL_RATE_LIMIT = { limit: 120, windowMs: 60_000 }; // hotel pages, per agency
const DEFAULT_TAKE = 20;
const MAX_TAKE = 50;
const MAX_SNAPSHOTS_PER_AGENCY = 50; // older searches are removed, so one agency cannot fill the database

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
};

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

const storedQuery = z.object({
  destinationId: z.string(),
  checkin: z.string(),
  checkout: z.string(),
  adults: z.number(),
  childAges: z.array(z.number()),
  countryCode: z.string(),
});

// Offers are read back from the database before the hotel page and booking use them: a damaged
// or old-format row gives "not found", never a half-read price.
const money = z.object({ minor: z.number().int(), currency: z.string().regex(/^[A-Z]{3}$/) }).strict();
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
    price: z
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
      .strict(),
  })
  .strict();
const storedOffers = z.array(offerSchema).min(1);

async function rateLimit(agencyId: string): Promise<void> {
  const { allowed } = await hitRateLimit(`search:agency:${agencyId}`, SEARCH_RATE_LIMIT.limit, SEARCH_RATE_LIMIT.windowMs);
  if (!allowed) throw new SearchRateLimited("Too many searches. Wait a minute and try again.");
}

// Asks Expedia for the next batch of a snapshot's candidates and stores the priced hotels.
async function fetchBatch(
  snapshot: { id: string; candidateIds: string[]; nextIndex: number; query: z.infer<typeof storedQuery> },
  supplierContext: SupplierContext,
  adapter: SupplierAdapter,
): Promise<number> {
  const batch = snapshot.candidateIds.slice(snapshot.nextIndex, snapshot.nextIndex + BATCH);
  if (batch.length === 0) return 0;
  const end = snapshot.nextIndex + batch.length;
  // Claim the batch first: of two load-more clicks at the same moment only one moves nextIndex
  // and asks Expedia; the other gets 0. A supplier failure gives the claim back.
  const claimed = await db.searchSnapshot.updateMany({ where: { id: snapshot.id, nextIndex: snapshot.nextIndex }, data: { nextIndex: end } });
  if (claimed.count === 0) return 0;
  let results;
  try {
    results = await adapter.searchAvailability(
      {
        propertyIds: batch,
        checkin: snapshot.query.checkin,
        checkout: snapshot.query.checkout,
        occupancy: { adults: snapshot.query.adults, childAges: snapshot.query.childAges },
        countryCode: snapshot.query.countryCode,
      },
      supplierContext,
    );
  } catch (error) {
    await db.searchSnapshot.updateMany({ where: { id: snapshot.id, nextIndex: end }, data: { nextIndex: snapshot.nextIndex } });
    if (error instanceof SupplierError) throw new SearchUnavailable("Hotel search is unavailable right now. Try again in a few minutes.");
    throw error;
  }

  const asked = new Set(batch);
  const byId = new Map<string, Offer[]>();
  for (const property of results) {
    if (!asked.has(property.propertyId) || byId.has(property.propertyId)) continue; // stranger or duplicate
    const offers = property.offers.filter((offer) => offer.propertyId === property.propertyId);
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
        refundableAvailable: offers.some((offer) => offer.refundable),
        offers: offers as unknown as Prisma.InputJsonValue,
      },
    ];
  });

  // One row per rate as well, so the results filters can match a single rate (see listResults).
  const rates = rows.flatMap((row) =>
    (byId.get(row.propertyId) ?? []).map((offer, rateIndex) => ({
      snapshotId: snapshot.id,
      propertyId: row.propertyId,
      rateIndex,
      roomName: offer.roomName.toLowerCase().slice(0, 300),
      refundable: offer.refundable,
      totalMinor: offer.price.total.minor,
      currency: offer.price.total.currency,
      feesAtProperty: offer.price.dueAtProperty.length > 0,
    })),
  );
  await db.$transaction([
    db.searchHotel.createMany({ data: rows, skipDuplicates: true }),
    db.searchRate.createMany({ data: rates, skipDuplicates: true }),
  ]);
  return batch.length;
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
  await rateLimit(ctx.agencyId);

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

  const query = { ...input, countryCode: agency.country };
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
  const older = await db.searchSnapshot.findMany({
    where: { agencyId: ctx.agencyId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: MAX_SNAPSHOTS_PER_AGENCY,
    select: { id: true },
  });
  if (older.length > 0) await db.searchSnapshot.deleteMany({ where: { agencyId: ctx.agencyId, id: { in: older.map((o) => o.id) } } });
  if (candidates.length > 0) {
    await fetchBatch({ ...snapshot, query }, ctx.supplierContext, deps.adapter ?? supplierAdapter());
    await prefetchContent(snapshot.id, deps.content ?? getContent, now);
  }
  return { snapshotId: snapshot.id };
}

async function ownSnapshot(agencyId: string, snapshotId: string) {
  if (typeof snapshotId !== "string" || snapshotId.length > 64) return null;
  return db.searchSnapshot.findFirst({ where: { id: snapshotId, agencyId } });
}

export async function loadMore(ctx: SearchContext, snapshotId: string, deps: Deps = {}): Promise<{ added: number; hasMore: boolean } | null> {
  const now = deps.now ?? new Date();
  const snapshot = await ownSnapshot(ctx.agencyId, snapshotId);
  if (!snapshot || snapshot.expiresAt <= now) return null;
  const query = storedQuery.parse(snapshot.query);
  if (snapshot.nextIndex >= snapshot.candidateIds.length) return { added: 0, hasMore: false };
  await rateLimit(ctx.agencyId);
  const added = await fetchBatch({ ...snapshot, query }, ctx.supplierContext, deps.adapter ?? supplierAdapter());
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
};

export async function listResults(
  agencyId: string,
  snapshotId: string,
  opts: ListOptions,
  now: Date = new Date(),
): Promise<{ hotels: HotelCard[]; total: number; nextCursor: string | null; hasMoreFromSupplier: boolean; expired: boolean } | null> {
  const snapshot = await ownSnapshot(agencyId, snapshotId);
  if (!snapshot) return null;
  if (snapshot.expiresAt <= now) return { hotels: [], total: 0, nextCursor: null, hasMoreFromSupplier: false, expired: true };

  const take = Math.min(Math.max(1, Math.trunc(opts.take ?? DEFAULT_TAKE)), MAX_TAKE);
  const skip = opts.cursor && /^\d{1,6}$/.test(opts.cursor) ? Number(opts.cursor) : 0;
  // Rate filters (room name, free cancellation, price) must all hold for one rate; the hotel
  // then shows its cheapest such rate. Hotel filters (name, stars) apply to the hotel.
  const rateWhere: Prisma.Sql[] = [Prisma.sql`r."snapshotId" = ${snapshot.id}`];
  const roomName = opts.roomName?.trim().slice(0, 100).toLowerCase();
  if (roomName) rateWhere.push(Prisma.sql`r."roomName" LIKE ${containsPattern(roomName)} ESCAPE '\\'`);
  if (opts.freeCancellation) rateWhere.push(Prisma.sql`r."refundable"`);
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
             bool_or(r."refundable") OVER (PARTITION BY r."propertyId") AS "anyRefundable",
             row_number() OVER (PARTITION BY r."propertyId" ORDER BY r."totalMinor" ASC, r."rateIndex" ASC) AS "rn"
      FROM "SearchRate" r
      WHERE ${Prisma.join(rateWhere, " AND ")}
    )`;
  const from = Prisma.sql`FROM m JOIN "SearchHotel" h ON h."snapshotId" = ${snapshot.id} AND h."propertyId" = m."propertyId"
    WHERE ${Prisma.join(hotelWhere, " AND ")}`;
  const [rows, counted] = await Promise.all([
    db.$queryRaw<ResultRow[]>`${matched}
      SELECT h."propertyId", h."name", h."city", h."starRating"::text AS "starRating",
             m."totalMinor", m."currency", m."feesAtProperty", m."anyRefundable"
      ${from}
      ORDER BY ${orderSql(opts.sort)}
      OFFSET ${skip} LIMIT ${take + 1}`,
    db.$queryRaw<{ count: bigint }[]>`${matched} SELECT count(*) AS "count" ${from}`,
  ]);
  const total = Number(counted[0]?.count ?? 0);
  const page = rows.slice(0, take);

  // Images from the content cache only: listing results never calls Expedia.
  const cached = await db.propertyContentCache.findMany({
    where: { propertyId: { in: page.map((r) => r.propertyId) } },
    select: { propertyId: true, data: true },
  });
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
    })),
    total,
    nextCursor: rows.length > take ? String(skip + take) : null,
    hasMoreFromSupplier: snapshot.nextIndex < snapshot.candidateIds.length,
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
  adults: number;
  childAges: number[];
  expired: boolean;
};

export async function searchSummary(agencyId: string, snapshotId: string, now: Date = new Date()): Promise<SearchSummary | null> {
  const snapshot = await ownSnapshot(agencyId, snapshotId);
  if (!snapshot) return null;
  const parsed = storedQuery.safeParse(snapshot.query);
  if (!parsed.success) return null;
  const q = parsed.data;
  const destination = await db.destination.findUnique({ where: { id: q.destinationId }, select: { nameFull: true } });
  return {
    destinationId: q.destinationId,
    destinationLabel: destination?.nameFull ?? "",
    checkin: q.checkin,
    checkout: q.checkout,
    nights: Math.round((Date.parse(`${q.checkout}T00:00:00Z`) - Date.parse(`${q.checkin}T00:00:00Z`)) / 86_400_000),
    adults: q.adults,
    childAges: q.childAges,
    expired: snapshot.expiresAt <= now,
  };
}

export async function getHotelOffers(
  agencyId: string,
  snapshotId: string,
  propertyId: string,
  now: Date = new Date(),
  deps: { content?: typeof getContent } = {},
): Promise<{ offers: Offer[]; content: PropertyContent | null; hotel: { name: string; city: string; starRating: string | null } } | null> {
  const { allowed } = await hitRateLimit(`hotel:agency:${agencyId}`, HOTEL_RATE_LIMIT.limit, HOTEL_RATE_LIMIT.windowMs);
  if (!allowed) throw new SearchRateLimited("Too many hotel pages opened. Wait a minute and try again.");
  const snapshot = await ownSnapshot(agencyId, snapshotId);
  if (!snapshot || snapshot.expiresAt <= now) return null;
  if (typeof propertyId !== "string" || propertyId.length > 64) return null;
  const hotel = await db.searchHotel.findUnique({ where: { snapshotId_propertyId: { snapshotId: snapshot.id, propertyId } } });
  if (!hotel) return null;
  const offers = storedOffers.safeParse(hotel.offers);
  if (!offers.success) return null;
  // Content (photos, policies) is best effort: without it the page still shows the rates.
  let content: PropertyContent | null = null;
  try {
    content = (await (deps.content ?? getContent)([propertyId], now)).get(propertyId) ?? null;
  } catch (error) {
    console.error(`hotel content failed: ${error instanceof Error ? error.name : "Error"}`);
  }
  return {
    offers: offers.data,
    content,
    hotel: { name: hotel.name, city: hotel.city, starRating: hotel.starRating?.toString() ?? null },
  };
}

// One rate of one hotel of the agency's own, unexpired search, for the booking pages. Everything
// a booking needs is read here on the server; the browser only names the rate.
export async function findOffer(
  agencyId: string,
  ref: { snapshotId: string; propertyId: string; rateId: string; bedGroupId: string },
  now: Date = new Date(),
): Promise<{ offer: Offer; bedGroup: Offer["bedGroups"][number]; hotel: { name: string; city: string }; query: z.infer<typeof storedQuery> } | null> {
  for (const value of Object.values(ref)) if (typeof value !== "string" || value.length === 0 || value.length > 128) return null;
  const snapshot = await ownSnapshot(agencyId, ref.snapshotId);
  if (!snapshot || snapshot.expiresAt <= now) return null;
  const query = storedQuery.safeParse(snapshot.query);
  if (!query.success) return null;
  const hotel = await db.searchHotel.findUnique({ where: { snapshotId_propertyId: { snapshotId: snapshot.id, propertyId: ref.propertyId } } });
  if (!hotel) return null;
  const offers = storedOffers.safeParse(hotel.offers);
  if (!offers.success) return null;
  const offer = offers.data.find((o) => o.rateId === ref.rateId);
  const bedGroup = offer?.bedGroups.find((b) => b.id === ref.bedGroupId);
  if (!offer || !bedGroup) return null;
  return { offer, bedGroup, hotel: { name: hotel.name, city: hotel.city }, query: query.data };
}

// Deletes searches whose expiry passed more than an hour ago (their hotels go with them).
export async function cleanupSnapshots(now: Date = new Date()): Promise<number> {
  const result = await db.searchSnapshot.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - CLEANUP_AFTER_MS) } } });
  return result.count;
}
