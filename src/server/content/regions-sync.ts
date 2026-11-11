import { db } from "@/server/db";
import { ExpediaContentSource } from "@/server/supplier/expedia/content";
import type { ContentSource, RegionInfo } from "@/server/supplier/types";
import { CONTENT_COUNTRIES } from "./scope";
import { finishSyncRun, startSyncRun } from "./sync-run";

// Daily destinations sync (plan 2b, task 4). For every country in CONTENT_COUNTRIES, follows
// every page of Rapid /regions (cities and multi-city areas, with their hotel ids). Each
// region's hotel list is replaced in one transaction. Regions not seen in this run are marked
// inactive only after every country finished: a failure anywhere (a rate limit, say) deactivates
// nothing, records the run FAILED, and the job queue retries it. A country that returns fewer
// than half of its active regions (none, say) also fails the run: that is a supplier problem,
// not cities that closed overnight.

const MAX_PAGES_PER_COUNTRY = 500; // a supplier loop must not keep the worker busy forever
const MIN_KEPT_SHARE = 0.5;

// One page of regions in one transaction: a few statements per page, not per region.
async function savePage(regions: RegionInfo[], runId: string): Promise<void> {
  const unique = [...new Map(regions.map((r) => [r.id, r])).values()];
  if (unique.length === 0) return;
  const rows = unique.map((r) => ({
    id: r.id,
    name: r.name,
    nameFull: r.nameFull,
    type: r.type,
    countryCode: r.countryCode,
    propertyCount: new Set(r.propertyIds).size,
  }));
  const links = unique.flatMap((r) => [...new Set(r.propertyIds)].map((propertyId) => ({ destinationId: r.id, propertyId })));
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO "Destination" ("id", "name", "nameFull", "type", "countryCode", "propertyCount", "active", "seenRunId", "updatedAt")
      SELECT x."id", x."name", x."nameFull", x."type", x."countryCode", x."propertyCount", true, ${runId}, now()
      FROM json_to_recordset(${JSON.stringify(rows)}::json) AS x(
        "id" text, "name" text, "nameFull" text, "type" text, "countryCode" text, "propertyCount" int)
      ON CONFLICT ("id") DO UPDATE SET
        "name" = EXCLUDED."name", "nameFull" = EXCLUDED."nameFull", "type" = EXCLUDED."type",
        "countryCode" = EXCLUDED."countryCode", "propertyCount" = EXCLUDED."propertyCount",
        "active" = true, "seenRunId" = EXCLUDED."seenRunId", "updatedAt" = now()`;
    await tx.destinationProperty.deleteMany({ where: { destinationId: { in: rows.map((r) => r.id) } } });
    if (links.length > 0) await tx.destinationProperty.createMany({ data: links, skipDuplicates: true });
  });
}

export async function syncRegions(deps: { source?: ContentSource } = {}): Promise<{ destinations: number; deactivated: number }> {
  const source = deps.source ?? new ExpediaContentSource();
  const run = await startSyncRun("content.regions");
  const counts = { destinations: 0, deactivated: 0 };

  try {
    for (const countryCode of CONTENT_COUNTRIES) {
      let next: string | undefined;
      let seen = 0;
      for (let page = 0; ; page++) {
        if (page >= MAX_PAGES_PER_COUNTRY) throw new Error(`regions sync: more than ${MAX_PAGES_PER_COUNTRY} pages for ${countryCode}`);
        const result = await source.listRegions(next ? { countryCode, next } : { countryCode });
        await savePage(result.regions, run.id);
        seen += result.regions.length;
        counts.destinations += result.regions.length;
        if (!result.next) break;
        next = result.next;
      }
      const active = await db.destination.count({ where: { countryCode, active: true } });
      if (seen < active * MIN_KEPT_SHARE) {
        throw new Error(`regions sync: refusing ${seen} regions for ${countryCode} while ${active} are active`);
      }
    }

    counts.deactivated = await db.destination
      .updateMany({
        where: { countryCode: { in: [...CONTENT_COUNTRIES] }, seenRunId: { not: run.id }, active: true },
        data: { active: false },
      })
      .then((r) => r.count);

    await finishSyncRun(run.id, "DONE", counts);
    return counts;
  } catch (error) {
    await finishSyncRun(run.id, "FAILED", counts);
    throw error;
  }
}
