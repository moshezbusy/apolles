import { db } from "@/server/db";

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
