import { db } from "@/server/db";
import { countryName } from "@/lib/countries";

// Destination suggestions for the search box: the start of an active destination's name,
// case-insensitive, bigger destinations first. Wildcard characters are matched literally.
export async function suggestDestinations(q: string, limit = 10): Promise<{ id: string; label: string; type: string }[]> {
  const text = q.trim();
  if (text.length < 2 || text.length > 60) return [];
  const pattern = `${text.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const take = Math.min(Math.max(1, Math.trunc(limit)), 20);
  return db.$queryRaw<{ id: string; label: string; type: string }[]>`
    SELECT "id", "nameFull" AS "label", "type" FROM "Destination"
    WHERE "active" AND lower("name") LIKE ${pattern} ESCAPE '\\'
    ORDER BY "propertyCount" DESC, "name" ASC
    LIMIT ${take}`;
}

// One active destination by id, with the label the search box shows (plan 5b: Search opened from
// a quote is filled with the quote's destination). null when it is gone or not active.
export async function destinationById(id: string): Promise<{ id: string; label: string } | null> {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  const row = await db.destination.findFirst({ where: { id, active: true }, select: { id: true, nameFull: true } });
  return row ? { id: row.id, label: row.nameFull } : null;
}

// Hotel suggestions for the same box: hotels an agent can search (active, Expedia-collect, in an
// active destination) whose name starts with the text, or has words starting with each word of
// it ("ritz par" finds "The Ritz Paris"). A match of the whole name's start comes first, then
// the supplier's rank. From 3 characters (2 would match a large part of the catalog). Served by
// the "property_name_words" index (a GIN index on the name's words, in the migration's raw SQL).
// The query is cut off after 1.5 seconds: a text that matches too much gives no hotels (the
// destinations are still shown), never a slow page.
export type HotelSuggestion = { id: string; name: string; place: string };

const HOTEL_MIN_LENGTH = 3;
const MAX_WORDS = 6;
const HOTEL_QUERY_TIMEOUT_MS = 1_500;

// The text's words as a Postgres text-search query, each word a prefix ("ritz:* & par:*"). Only
// letters and digits are kept, so nothing typed can change the query's meaning. null: no words.
export function hotelWords(text: string): string | null {
  const words = text.normalize("NFC").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).slice(0, MAX_WORDS);
  return words.length > 0 ? words.map((word) => `${word}:*`).join(" & ") : null;
}

export async function suggestHotels(q: string, limit = 6): Promise<HotelSuggestion[]> {
  const text = q.trim().normalize("NFC");
  if (text.length < HOTEL_MIN_LENGTH || text.length > 60) return [];
  const words = hotelWords(text);
  if (!words) return [];
  const prefix = `${text.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const take = Math.min(Math.max(1, Math.trunc(limit)), 20);
  try {
    const rows = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('statement_timeout', ${String(HOTEL_QUERY_TIMEOUT_MS)}, true)`;
      return tx.$queryRaw<{ id: string; name: string; city: string; countryCode: string }[]>`
        SELECT p."id", p."name", p."city", p."countryCode" FROM "Property" p
        WHERE p."active" AND p."expediaCollect"
          AND to_tsvector('simple', p."name") @@ to_tsquery('simple', ${words})
          AND EXISTS (
            SELECT 1 FROM "DestinationProperty" dp JOIN "Destination" d ON d."id" = dp."destinationId"
            WHERE dp."propertyId" = p."id" AND d."active")
        ORDER BY (lower(p."name") LIKE ${prefix} ESCAPE '\\') DESC, p."rank" ASC NULLS LAST, p."name" ASC, p."id" ASC
        LIMIT ${take}`;
    });
    return rows.map((row) => ({ id: row.id, name: row.name, place: [row.city, countryName(row.countryCode)].filter(Boolean).join(", ") }));
  } catch (error) {
    console.error(`hotel suggestions failed: ${error instanceof Error ? error.name : "Error"}`);
    return [];
  }
}

// The destination a search of one hotel is stored under (for the quote it may be added to and
// for "Search again"): its active city, the smallest one if there are several, else its smallest
// active area. null when the hotel is in no active destination (it is then not searchable).
export async function hotelDestination(propertyId: string): Promise<string | null> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT d."id" FROM "DestinationProperty" dp JOIN "Destination" d ON d."id" = dp."destinationId"
    WHERE dp."propertyId" = ${propertyId} AND d."active"
    ORDER BY (d."type" = 'city') DESC, d."propertyCount" ASC, d."id" ASC
    LIMIT 1`;
  return rows[0]?.id ?? null;
}
