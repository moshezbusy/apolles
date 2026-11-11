import { db } from "@/server/db";

// One content sync of a kind at a time. Two workers (or a retry while the first try still
// runs) would otherwise both write, and one could deactivate what the other just saw. The
// check and the insert run under a Postgres advisory lock for the kind, so two starts can
// never both pass. A RUNNING run older than 2 hours is a dead worker's: it is closed as FAILED.

const STALE_RUN_MS = 2 * 3_600_000;

export class SyncAlreadyRunning extends Error {
  constructor(kind: string) {
    super(`${kind} sync already running`);
    this.name = "SyncAlreadyRunning";
  }
}

export async function startSyncRun(kind: string, startedAt?: Date): Promise<{ id: string }> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`content-sync:${kind}`}))`;
    await tx.contentSyncRun.updateMany({
      where: { kind, status: "RUNNING", startedAt: { lt: new Date(Date.now() - STALE_RUN_MS) } },
      data: { status: "FAILED", finishedAt: new Date() },
    });
    if (await tx.contentSyncRun.findFirst({ where: { kind, status: "RUNNING" }, select: { id: true } })) {
      throw new SyncAlreadyRunning(kind);
    }
    return tx.contentSyncRun.create({ data: startedAt ? { kind, startedAt } : { kind }, select: { id: true } });
  });
}

export async function finishSyncRun(id: string, status: "DONE" | "FAILED", counts: Record<string, number>): Promise<void> {
  await db.contentSyncRun.update({ where: { id }, data: { status, finishedAt: new Date(), counts } });
}
