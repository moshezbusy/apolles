import { z } from "zod";
import { stripNul } from "@/lib/strip-nul";
import { db } from "@/server/db";
import { SupplierError } from "@/server/supplier/expedia/client";
import { ExpediaContentSource } from "@/server/supplier/expedia/content";
import type { ContentSource, PropertyContent } from "@/server/supplier/types";

// Hotel content for search results and the hotel page (plan 2b, task 5). Content younger than
// 24 hours comes from the cache; missing or older content is fetched in batches of 250. When
// Expedia is unavailable, content up to 7 days old is still served; anything older is left out
// (the caller shows the hotel without it). A cached row is checked against the content shape
// before use, so a damaged row is refetched instead of reaching a page.

const FRESH_MS = 24 * 3_600_000;
const STALE_LIMIT_MS = 7 * 24 * 3_600_000;
const BATCH = 250;

const image = z.object({ url: z.string().startsWith("https://"), caption: z.string().nullable() });
const contentShape: z.ZodType<PropertyContent> = z.object({
  propertyId: z.string(),
  name: z.string(),
  address: z.object({
    line1: z.string(),
    city: z.string(),
    stateProvince: z.string().nullable(),
    postalCode: z.string().nullable(),
    countryCode: z.string(),
  }),
  starRating: z.string().nullable(),
  coordinates: z.object({ lat: z.string(), lng: z.string() }).nullable(),
  heroImage: image.nullable(),
  images: z.array(image),
  amenities: z.array(z.string()),
  checkin: z.object({
    beginTime: z.string().nullable(),
    endTime: z.string().nullable(),
    instructions: z.string().nullable(),
    specialInstructions: z.string().nullable(),
    minAge: z.number().nullable(),
  }),
  checkout: z.object({ time: z.string().nullable() }),
  fees: z.object({ mandatory: z.string().nullable(), optional: z.string().nullable() }),
  knowBeforeYouGo: z.string().nullable(),
  description: z.string().nullable(),
  onsiteCurrency: z.string().nullable(),
  rooms: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      images: z.array(image),
      amenities: z.array(z.string()),
      maxOccupancy: z.number().nullable(),
    }),
  ),
});

export async function getContent(
  ids: string[],
  now: Date = new Date(),
  deps: { source?: ContentSource } = {},
): Promise<Map<string, PropertyContent>> {
  const source = deps.source ?? new ExpediaContentSource();
  const unique = [...new Set(ids)];
  const result = new Map<string, PropertyContent>();
  const stale = new Map<string, { data: PropertyContent; fetchedAt: Date }>();

  const rows = await db.propertyContentCache.findMany({ where: { propertyId: { in: unique } } });
  for (const row of rows) {
    const parsed = contentShape.safeParse(row.data);
    if (!parsed.success) continue; // damaged: refetch
    if (now.getTime() - row.fetchedAt.getTime() < FRESH_MS) result.set(row.propertyId, parsed.data);
    else stale.set(row.propertyId, { data: parsed.data, fetchedAt: row.fetchedAt });
  }

  const missing = unique.filter((id) => !result.has(id));
  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH);
    try {
      const fetched = (await source.propertyContent(batch)).filter((item) => batch.includes(item.propertyId)); // never cache a hotel we did not ask for
      const items = [...new Map(fetched.map((item) => [item.propertyId, stripNul(item)])).values()];
      for (const item of items) result.set(item.propertyId, item);
      if (items.length > 0) {
        // One statement per batch of up to 250 hotels.
        await db.$executeRaw`
          INSERT INTO "PropertyContentCache" ("propertyId", "data", "fetchedAt")
          SELECT x."propertyId", x."data", ${now}
          FROM json_to_recordset(${JSON.stringify(items.map((item) => ({ propertyId: item.propertyId, data: item })))}::json)
            AS x("propertyId" text, "data" jsonb)
          ON CONFLICT ("propertyId") DO UPDATE SET "data" = EXCLUDED."data", "fetchedAt" = EXCLUDED."fetchedAt"`;
      }
    } catch (error) {
      if (!(error instanceof SupplierError)) throw error;
      // Expedia is unavailable: fall back to stale content within the limit.
    }
    for (const id of batch) {
      const old = stale.get(id);
      if (!result.has(id) && old && now.getTime() - old.fetchedAt.getTime() < STALE_LIMIT_MS) result.set(id, old.data);
    }
  }
  return result;
}
