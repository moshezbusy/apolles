import { db } from "@/server/db";
import { ExpediaContentSource } from "@/server/supplier/expedia/content";
import type { ContentSource } from "@/server/supplier/types";
import { finishSyncRun, startSyncRun } from "./sync-run";

// Daily: hotels that became inactive at Expedia are marked inactive here (so search stops
// offering them) and their cached content is deleted (plan 2b, task 5). "Since" is the start
// of the last successful run, or one day back on the first run.

const MAX_PAGES = 500;

export async function syncInactive(now: Date = new Date(), deps: { source?: ContentSource } = {}): Promise<{ deactivated: number }> {
  const source = deps.source ?? new ExpediaContentSource();
  const last = await db.contentSyncRun.findFirst({
    where: { kind: "content.inactive", status: "DONE" },
    orderBy: { startedAt: "desc" },
    select: { startedAt: true },
  });
  const since = (last?.startedAt ?? new Date(now.getTime() - 24 * 3_600_000)).toISOString().slice(0, 10);
  const run = await startSyncRun("content.inactive", now);
  const counts = { deactivated: 0 };

  try {
    let next: string | undefined;
    for (let page = 0; ; page++) {
      if (page >= MAX_PAGES) throw new Error(`inactive sync: more than ${MAX_PAGES} pages`);
      const result = await source.inactiveSince(next ? { since, next } : { since });
      if (result.propertyIds.length > 0) {
        await db.$transaction(async (tx) => {
          const updated = await tx.property.updateMany({ where: { id: { in: result.propertyIds }, active: true }, data: { active: false } });
          await tx.propertyContentCache.deleteMany({ where: { propertyId: { in: result.propertyIds } } });
          counts.deactivated += updated.count;
        });
      }
      if (!result.next) break;
      next = result.next;
    }
    await finishSyncRun(run.id, "DONE", counts);
    return counts;
  } catch (error) {
    await finishSyncRun(run.id, "FAILED", counts);
    throw error;
  }
}
