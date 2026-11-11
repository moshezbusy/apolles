import { db } from "@/server/db";
import { ExpediaContentSource } from "@/server/supplier/expedia/content";
import type { ContentSource, RegionInfo } from "@/server/supplier/types";
import { CONTENT_COUNTRIES } from "./scope";

// Daily destinations sync (plan 2b, task 4). For every country in CONTENT_COUNTRIES, follows
// every page of Rapid /regions (cities and multi-city areas, with their hotel ids). Each
// region's hotel list is replaced in one transaction. Regions not seen in this run are marked
// inactive only after every country finished: a failure anywhere (a rate limit, say) deactivates
// nothing, records the run FAILED, and the job queue retries it.

const MAX_PAGES_PER_COUNTRY = 500; // a supplier loop must not keep the worker busy forever

async function saveRegion(region: RegionInfo, runId: string): Promise<void> {
  const propertyIds = [...new Set(region.propertyIds)];
  await db.$transaction(async (tx) => {
    await tx.destination.upsert({
      where: { id: region.id },
      create: {
        id: region.id,
        name: region.name,
        nameFull: region.nameFull,
        type: region.type,
        countryCode: region.countryCode,
        propertyCount: propertyIds.length,
        active: true,
        seenRunId: runId,
      },
      update: {
        name: region.name,
        nameFull: region.nameFull,
        type: region.type,
        countryCode: region.countryCode,
        propertyCount: propertyIds.length,
        active: true,
        seenRunId: runId,
      },
    });
    await tx.destinationProperty.deleteMany({ where: { destinationId: region.id } });
    if (propertyIds.length > 0) {
      await tx.destinationProperty.createMany({
        data: propertyIds.map((propertyId) => ({ destinationId: region.id, propertyId })),
        skipDuplicates: true,
      });
    }
  });
}

export async function syncRegions(deps: { source?: ContentSource } = {}): Promise<{ destinations: number; deactivated: number }> {
  const source = deps.source ?? new ExpediaContentSource();
  const run = await db.contentSyncRun.create({ data: { kind: "content.regions" } });
  const counts = { destinations: 0, deactivated: 0 };

  try {
    for (const countryCode of CONTENT_COUNTRIES) {
      let next: string | undefined;
      for (let page = 0; ; page++) {
        if (page >= MAX_PAGES_PER_COUNTRY) throw new Error(`regions sync: more than ${MAX_PAGES_PER_COUNTRY} pages for ${countryCode}`);
        const result = await source.listRegions(next ? { countryCode, next } : { countryCode });
        for (const region of result.regions) {
          await saveRegion(region, run.id);
          counts.destinations++;
        }
        if (!result.next) break;
        next = result.next;
      }
    }

    counts.deactivated = await db.destination
      .updateMany({
        where: { countryCode: { in: [...CONTENT_COUNTRIES] }, seenRunId: { not: run.id }, active: true },
        data: { active: false },
      })
      .then((r) => r.count);

    await db.contentSyncRun.update({ where: { id: run.id }, data: { status: "DONE", finishedAt: new Date(), counts } });
    return counts;
  } catch (error) {
    await db.contentSyncRun.update({ where: { id: run.id }, data: { status: "FAILED", finishedAt: new Date(), counts } });
    throw error;
  }
}
