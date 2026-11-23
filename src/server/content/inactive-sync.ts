import { db } from "@/server/db";
import { ExpediaContentSource } from "@/server/supplier/expedia/content";
import type { ContentSource } from "@/server/supplier/types";
import { type Sleep, withSyncRetry } from "./retry";
import { finishSyncRun, skipSyncForDemo, startSyncRun, syncHeartbeat } from "./sync-run";

// Daily: hotels that became inactive at Expedia are marked inactive here (so search stops
// offering them) and their cached content is deleted (plan 2b, task 5). "Since" is the start
// of the last successful run, or one day back on the first run. A page that times out or is rate
// limited is asked for again (up to 3 tries, retry.ts). With the demo supplier it does nothing.

const MAX_PAGES = 500;

export async function syncInactive(now: Date = new Date(), deps: { source?: ContentSource; sleep?: Sleep } = {}): Promise<{ deactivated: number }> {
  if (skipSyncForDemo("content.inactive", deps.source !== undefined)) return { deactivated: 0 };
  const source = deps.source ?? new ExpediaContentSource();
  const last = await db.contentSyncRun.findFirst({
    where: { kind: "content.inactive", status: "DONE" },
    orderBy: { startedAt: "desc" },
    select: { startedAt: true },
  });
  const since = (last?.startedAt ?? new Date(now.getTime() - 24 * 3_600_000)).toISOString().slice(0, 10);
  const run = await startSyncRun("content.inactive", now);
  const counts = { deactivated: 0 };
  const alive = syncHeartbeat(run.id);

  try {
    let next: string | undefined;
    for (let page = 0; ; page++) {
      if (page >= MAX_PAGES) throw new Error(`inactive sync: more than ${MAX_PAGES} pages`);
      const result = await withSyncRetry(() => source.inactiveSince(next ? { since, next } : { since }), deps.sleep);
      await alive(); // also stops a run that a newer one took over, before it writes
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
