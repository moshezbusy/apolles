import { db } from "@/server/db";
import { isDemoSupplier } from "@/server/supplier";

// One content sync of a kind at a time. Two workers (or a retry while the first try still
// runs) would otherwise both write, and one could deactivate what the other just saw. The
// check and the insert run under a Postgres advisory lock for the kind, so two starts can
// never both pass.
//
// A running sync shows it is alive (touchSyncRun: after every page or batch, at most every 30
// seconds). A RUNNING run with no sign of life for 10 minutes is a dead worker's (a restart
// during the sync, say): the next try closes it as FAILED and takes over, instead of waiting
// hours and losing the day's sync. If the old run was only stuck and wakes up, its next
// touchSyncRun finds the run closed and stops it (SyncRunTakenOver) before it can deactivate
// anything. A run from before the heartbeat existed is judged by when it started.

const STALE_RUN_MS = 10 * 60_000;
const TOUCH_EVERY_MS = 30_000;

export class SyncAlreadyRunning extends Error {
  constructor(kind: string) {
    super(`${kind} sync already running`);
    this.name = "SyncAlreadyRunning";
  }
}

export class SyncRunTakenOver extends Error {
  constructor() {
    super("content sync run was closed and taken over by a newer run");
    this.name = "SyncRunTakenOver";
  }
}

export async function startSyncRun(kind: string, startedAt?: Date): Promise<{ id: string }> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`content-sync:${kind}`}))`;
    const stale = new Date(Date.now() - STALE_RUN_MS);
    await tx.contentSyncRun.updateMany({
      where: { kind, status: "RUNNING", OR: [{ heartbeatAt: { lt: stale } }, { heartbeatAt: null, startedAt: { lt: stale } }] },
      data: { status: "FAILED", finishedAt: new Date() },
    });
    if (await tx.contentSyncRun.findFirst({ where: { kind, status: "RUNNING" }, select: { id: true } })) {
      throw new SyncAlreadyRunning(kind);
    }
    return tx.contentSyncRun.create({ data: { kind, heartbeatAt: new Date(), ...(startedAt ? { startedAt } : {}) }, select: { id: true } });
  });
}

// "Still alive": moves the run's heartbeat. Throws SyncRunTakenOver when the run is no longer
// RUNNING (a newer run took over), so the caller stops before changing anything else.
export async function touchSyncRun(id: string): Promise<void> {
  const touched = await db.contentSyncRun.updateMany({ where: { id, status: "RUNNING" }, data: { heartbeatAt: new Date() } });
  if (touched.count === 0) throw new SyncRunTakenOver();
}

// A touch for loops: at most one write every 30 seconds however often it is called; `force`
// always writes (before a step that must not run in a run that was taken over).
export function syncHeartbeat(id: string): (force?: boolean) => Promise<void> {
  let last = Date.now();
  return async (force = false) => {
    if (!force && Date.now() - last < TOUCH_EVERY_MS) return;
    await touchSyncRun(id);
    last = Date.now();
  };
}

// Closes the run. Only a run that is still RUNNING: one already closed by a takeover stays as
// the takeover left it.
export async function finishSyncRun(id: string, status: "DONE" | "FAILED", counts: Record<string, number>): Promise<void> {
  await db.contentSyncRun.updateMany({ where: { id, status: "RUNNING" }, data: { status, finishedAt: new Date(), counts } });
}

// The daily content jobs ask Expedia. With the demo supplier (SUPPLIER_MODE=fake: staging
// without Expedia keys) there is nothing to ask and every try would fail, three times a day:
// the sync says so in the log and does nothing. Tests that hand in their own source still run.
export function skipSyncForDemo(kind: string, sourceGiven: boolean): boolean {
  if (sourceGiven || !isDemoSupplier()) return false;
  console.info(`${kind} sync skipped: the demo supplier is on (SUPPLIER_MODE=fake), there is nothing to sync from Expedia`);
  return true;
}
