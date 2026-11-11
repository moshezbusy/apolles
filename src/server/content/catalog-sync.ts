import { z } from "zod";
import { db } from "@/server/db";
import { ExpediaContentSource } from "@/server/supplier/expedia/content";
import type { ContentSource } from "@/server/supplier/types";
import { openCatalogStream } from "./download";
import { CONTENT_COUNTRIES } from "./scope";
import { finishSyncRun, startSyncRun } from "./sync-run";

// Daily hotel list sync (plan 2b, task 3). Reads Expedia's full catalog file line by line,
// keeps the hotels in CONTENT_COUNTRIES, and upserts them in batches of 1,000. Only after the
// whole file was read are hotels of those countries that were not in it marked inactive: a
// download that breaks halfway changes nothing to "inactive", and the run is recorded FAILED.
// A file that looks broken (empty, mostly invalid lines, or far fewer hotels than are active
// now) deactivates nothing either: the run fails and the owner sees it, instead of search
// suddenly offering no hotels.

const BATCH_SIZE = 1_000;
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_INT = 2_147_483_647; // Postgres int
const MIN_KEPT_SHARE = 0.5; // refuse a file with fewer than half of the hotels active now
const MAX_INVALID_SHARE = 0.1; // refuse a file where more than 10% of lines are unreadable…
const INVALID_ALLOWANCE = 100; // …once there are more than 100 of them

// Postgres text cannot hold NUL; one such character must not fail a batch of 1,000 hotels.
const text = (max: number) => z.string().transform((v) => v.replaceAll("\u0000", "")).pipe(z.string().max(max));

// The catalog line is a subset of the property content schema; only the fields we store are read.
const catalogLine = z.object({
  property_id: z.string().regex(SAFE_ID),
  name: text(300).pipe(z.string().min(1)),
  address: z.object({
    city: text(200),
    country_code: z.string().regex(/^[A-Z]{2}$/),
    state_province_name: text(200).optional(),
  }),
  ratings: z.object({ property: z.object({ rating: z.string().regex(/^\d(\.\d)?$/) }).optional() }).optional(),
  location: z.object({ coordinates: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }).optional() }).optional(),
  rank: z.number().int().nonnegative().max(MAX_INT).optional(),
  business_model: z.object({ expedia_collect: z.boolean() }).optional(),
});

type Row = {
  id: string;
  name: string;
  city: string;
  countryCode: string;
  stateProvince: string | null;
  starRating: string | null;
  latitude: string | null;
  longitude: string | null;
  rank: number | null;
  expediaCollect: boolean;
};

async function upsertBatch(input: Row[], runId: string): Promise<number> {
  // The same hotel twice in one statement would fail the whole batch: the last line wins.
  const rows = [...new Map(input.map((row) => [row.id, row])).values()];
  if (rows.length === 0) return 0;
  // One statement per batch. Decimals travel as text and are cast by Postgres: no float math.
  await db.$executeRaw`
    INSERT INTO "Property" ("id", "name", "city", "countryCode", "stateProvince", "starRating", "latitude", "longitude",
                            "rank", "expediaCollect", "active", "catalogSeenRunId", "updatedAt")
    SELECT x."id", x."name", x."city", x."countryCode", x."stateProvince", x."starRating"::numeric(2,1),
           x."latitude"::numeric(9,6), x."longitude"::numeric(9,6), x."rank", x."expediaCollect", true, ${runId}, now()
    FROM json_to_recordset(${JSON.stringify(rows)}::json) AS x(
      "id" text, "name" text, "city" text, "countryCode" text, "stateProvince" text, "starRating" text,
      "latitude" text, "longitude" text, "rank" int, "expediaCollect" boolean)
    ON CONFLICT ("id") DO UPDATE SET
      "name" = EXCLUDED."name", "city" = EXCLUDED."city", "countryCode" = EXCLUDED."countryCode",
      "stateProvince" = EXCLUDED."stateProvince", "starRating" = EXCLUDED."starRating",
      "latitude" = EXCLUDED."latitude", "longitude" = EXCLUDED."longitude", "rank" = EXCLUDED."rank",
      "expediaCollect" = EXCLUDED."expediaCollect", "active" = true,
      "catalogSeenRunId" = EXCLUDED."catalogSeenRunId", "updatedAt" = now()`;
  return rows.length;
}

export async function syncCatalog(
  deps: { source?: ContentSource; open?: typeof openCatalogStream } = {},
): Promise<{ upserted: number; invalid: number; skippedCountry: number; deactivated: number }> {
  const source = deps.source ?? new ExpediaContentSource();
  const open = deps.open ?? openCatalogStream;
  const scope = new Set(CONTENT_COUNTRIES);
  const run = await startSyncRun("content.catalog");
  const counts = { upserted: 0, invalid: 0, skippedCountry: 0, deactivated: 0 };

  try {
    const { href } = await source.catalogLink();
    let batch: Row[] = [];
    let lines = 0;
    for await (const line of await open(href)) {
      lines++;
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch {
        counts.invalid++;
        continue;
      }
      const parsed = catalogLine.safeParse(raw);
      if (!parsed.success) {
        counts.invalid++;
        continue;
      }
      const p = parsed.data;
      if (!scope.has(p.address.country_code)) {
        counts.skippedCountry++;
        continue;
      }
      const coords = p.location?.coordinates;
      batch.push({
        id: p.property_id,
        name: p.name,
        city: p.address.city,
        countryCode: p.address.country_code,
        stateProvince: p.address.state_province_name ?? null,
        starRating: p.ratings?.property?.rating ?? null,
        latitude: coords ? coords.latitude.toFixed(6) : null,
        longitude: coords ? coords.longitude.toFixed(6) : null,
        rank: p.rank ?? null,
        expediaCollect: p.business_model?.expedia_collect ?? false,
      });
      if (batch.length >= BATCH_SIZE) {
        counts.upserted += await upsertBatch(batch, run.id);
        batch = [];
      }
    }
    counts.upserted += await upsertBatch(batch, run.id);

    const before = await db.property.count({ where: { countryCode: { in: [...scope] }, active: true } });
    if (counts.upserted === 0) throw new Error("catalog sync: refusing a file with no hotels in our countries");
    if (counts.invalid > Math.max(INVALID_ALLOWANCE, lines * MAX_INVALID_SHARE)) {
      throw new Error(`catalog sync: refusing a file with ${counts.invalid} unreadable lines of ${lines}`);
    }
    if (counts.upserted < before * MIN_KEPT_SHARE) {
      throw new Error(`catalog sync: refusing a file with ${counts.upserted} hotels while ${before} are active`);
    }

    // The whole file was read: hotels of these countries that it did not list are inactive now.
    counts.deactivated = await db.property.updateMany({
      where: { countryCode: { in: [...scope] }, catalogSeenRunId: { not: run.id }, active: true },
      data: { active: false },
    }).then((r) => r.count);

    await finishSyncRun(run.id, "DONE", counts);
    return counts;
  } catch (error) {
    await finishSyncRun(run.id, "FAILED", counts);
    throw error;
  }
}
