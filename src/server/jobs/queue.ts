import type { Job, Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import type { JobKind } from "./kinds";

// A small job queue in Postgres (spec section 7). A job is claimed in one statement with
// FOR UPDATE SKIP LOCKED, so two worker processes never run the same job. A failed job is
// retried after 1, then 5 minutes; the third failure is final. A job still RUNNING 30 minutes
// after it was claimed is treated as abandoned (the worker died) and claimed again.

const BACKOFF_MINUTES = [1, 5, 30];
const MAX_ATTEMPTS = 3;
const STALE_LOCK_MS = 30 * 60_000;
const MAX_ERROR_LENGTH = 500;

export async function enqueue(
  kind: JobKind,
  payload: Prisma.InputJsonObject,
  opts: { runAt?: Date; dedupeKey?: string } = {},
): Promise<{ id: string; created: boolean }> {
  const runAt = opts.runAt ?? new Date();
  if (opts.dedupeKey) {
    // DO NOTHING (no row rewrite when it exists), then read the existing row's id.
    const payloadJson = JSON.stringify(payload);
    const inserted = await db.$queryRaw<{ id: string }[]>`
      INSERT INTO "Job" ("id", "kind", "payload", "status", "attempts", "runAt", "dedupeKey", "createdAt")
      VALUES (gen_random_uuid()::text, ${kind}, ${payloadJson}::jsonb, 'QUEUED', 0, ${runAt}, ${opts.dedupeKey}, now())
      ON CONFLICT ("dedupeKey") DO NOTHING
      RETURNING "id"`;
    const [row] = inserted;
    if (row) return { id: row.id, created: true };
    const existing = await db.job.findUniqueOrThrow({ where: { dedupeKey: opts.dedupeKey }, select: { id: true } });
    return { id: existing.id, created: false };
  }
  const job = await db.job.create({ data: { kind, payload, runAt }, select: { id: true } });
  return { id: job.id, created: true };
}

export async function claimNext(now: Date): Promise<Job | null> {
  const staleBefore = new Date(now.getTime() - STALE_LOCK_MS);
  // An abandoned job that already used every attempt is final: FAILED, never run again.
  await db.$executeRaw`
    UPDATE "Job" SET "status" = 'FAILED', "lockedAt" = NULL, "finishedAt" = ${now},
      "lastError" = COALESCE("lastError", 'Abandoned: the worker stopped during the last attempt')
    WHERE "status" = 'RUNNING' AND "lockedAt" < ${staleBefore} AND "attempts" >= ${MAX_ATTEMPTS}`;
  const rows = await db.$queryRaw<Job[]>`
    UPDATE "Job" SET "status" = 'RUNNING', "lockedAt" = ${now}, "attempts" = "attempts" + 1
    WHERE "id" = (
      SELECT "id" FROM "Job"
      WHERE ("status" = 'QUEUED' AND "runAt" <= ${now})
         OR ("status" = 'RUNNING' AND "lockedAt" < ${staleBefore})
      ORDER BY "runAt", "createdAt"
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *`;
  return rows[0] ?? null;
}

// Keeps a running job's lock fresh, so a long job is never taken for abandoned.
export async function heartbeat(id: string, now: Date): Promise<void> {
  await db.job.updateMany({ where: { id, status: "RUNNING" }, data: { lockedAt: now } });
}

export async function completeJob(id: string): Promise<void> {
  await db.job.update({ where: { id }, data: { status: "DONE", lockedAt: null, finishedAt: new Date() } });
}

function describeError(error: unknown): string {
  const name = error instanceof Error ? error.name : "Error";
  const message = error instanceof Error ? error.message : String(error);
  return `${name}: ${message}`.slice(0, MAX_ERROR_LENGTH);
}

export async function failJob(id: string, error: unknown, now: Date): Promise<void> {
  const job = await db.job.findUniqueOrThrow({ where: { id }, select: { attempts: true } });
  const lastError = describeError(error);
  if (job.attempts >= MAX_ATTEMPTS) {
    await db.job.update({ where: { id }, data: { status: "FAILED", lockedAt: null, lastError, finishedAt: now } });
    return;
  }
  const delay = BACKOFF_MINUTES[job.attempts - 1] ?? BACKOFF_MINUTES[BACKOFF_MINUTES.length - 1] ?? 30;
  await db.job.update({
    where: { id },
    data: { status: "QUEUED", lockedAt: null, lastError, runAt: new Date(now.getTime() + delay * 60_000) },
  });
}
