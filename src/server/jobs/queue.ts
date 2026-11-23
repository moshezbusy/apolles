import { Prisma, type Job } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { DEFAULT_MAX_ATTEMPTS, EMAIL_KINDS, EMAIL_MAX_ATTEMPTS, LONG_KINDS, retryPolicy, type JobKind } from "./kinds";

// A small job queue in Postgres (spec section 7). A job is claimed in one statement with
// FOR UPDATE SKIP LOCKED, so two worker processes never run the same job. A failed job is
// retried after 1, then 5 minutes, and the third failure is final; an email job is tried 8 times
// over a day (kinds.ts). A short job still RUNNING 10 minutes after it was claimed is treated as
// abandoned (the worker died) and claimed again; a long job (a content sync) after 30 minutes.
// A running job refreshes its lock every 2 minutes (runner.ts), so a live one is never taken.
// Jobs that are due are claimed in order of time, booking, money and email jobs before long ones.

const SHORT_STALE_LOCK_MS = 10 * 60_000;
const LONG_STALE_LOCK_MS = 30 * 60_000;
const MAX_ERROR_LENGTH = 500;

// "long": only the long jobs (LONG_KINDS); "short": everything else; "all": both, short first.
export type Lane = "all" | "long" | "short";

const IS_LONG = Prisma.sql`"kind" = ANY(${[...LONG_KINDS]}::text[])`;
const IS_EMAIL = Prisma.sql`"kind" = ANY(${[...EMAIL_KINDS]}::text[])`;
// Every attempt of the job's kind is used.
const SPENT = Prisma.sql`((${IS_EMAIL} AND "attempts" >= ${EMAIL_MAX_ATTEMPTS}) OR (NOT ${IS_EMAIL} AND "attempts" >= ${DEFAULT_MAX_ATTEMPTS}))`;

// RUNNING, and its lock is older than its kind allows: the worker that had it is gone.
function abandoned(now: Date): Prisma.Sql {
  const short = new Date(now.getTime() - SHORT_STALE_LOCK_MS);
  const long = new Date(now.getTime() - LONG_STALE_LOCK_MS);
  return Prisma.sql`("status" = 'RUNNING' AND ((${IS_LONG} AND "lockedAt" < ${long}) OR (NOT ${IS_LONG} AND "lockedAt" < ${short})))`;
}

export async function enqueue(
  kind: JobKind,
  payload: Prisma.InputJsonObject,
  opts: { runAt?: Date; dedupeKey?: string } = {},
  // A caller's transaction: the job then exists only if that transaction commits.
  client: Prisma.TransactionClient = db,
): Promise<{ id: string; created: boolean }> {
  const runAt = opts.runAt ?? new Date();
  if (opts.dedupeKey) {
    // DO NOTHING (no row rewrite when it exists), then read the existing row's id.
    const payloadJson = JSON.stringify(payload);
    const inserted = await client.$queryRaw<{ id: string }[]>`
      INSERT INTO "Job" ("id", "kind", "payload", "status", "attempts", "runAt", "dedupeKey", "createdAt")
      VALUES (gen_random_uuid()::text, ${kind}, ${payloadJson}::jsonb, 'QUEUED', 0, ${runAt}, ${opts.dedupeKey}, now())
      ON CONFLICT ("dedupeKey") DO NOTHING
      RETURNING "id"`;
    const [row] = inserted;
    if (row) return { id: row.id, created: true };
    const existing = await client.job.findUniqueOrThrow({ where: { dedupeKey: opts.dedupeKey }, select: { id: true } });
    return { id: existing.id, created: false };
  }
  const job = await client.job.create({ data: { kind, payload, runAt }, select: { id: true } });
  return { id: job.id, created: true };
}

// An abandoned job that already used every attempt is final: FAILED, never run again. Returns
// the jobs given up on by this call (each one once), so the caller can log them and tell someone.
export async function failAbandoned(now: Date): Promise<Job[]> {
  return db.$queryRaw<Job[]>`
    UPDATE "Job" SET "status" = 'FAILED', "lockedAt" = NULL, "finishedAt" = ${now},
      "lastError" = COALESCE("lastError", 'Abandoned: the worker stopped during the last attempt')
    WHERE ${abandoned(now)} AND ${SPENT}
    RETURNING *`;
}

export async function claimNext(now: Date, lane: Lane = "all"): Promise<Job | null> {
  await failAbandoned(now);
  const inLane = lane === "long" ? Prisma.sql`AND ${IS_LONG}` : lane === "short" ? Prisma.sql`AND NOT ${IS_LONG}` : Prisma.empty;
  const rows = await db.$queryRaw<Job[]>`
    UPDATE "Job" SET "status" = 'RUNNING', "lockedAt" = ${now}, "attempts" = "attempts" + 1
    WHERE "id" = (
      SELECT "id" FROM "Job"
      WHERE (("status" = 'QUEUED' AND "runAt" <= ${now}) OR (${abandoned(now)} AND NOT ${SPENT}))
        ${inLane}
      ORDER BY (CASE WHEN ${IS_LONG} THEN 1 ELSE 0 END), "runAt", "createdAt"
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

// Puts a failed job back with its kind's backoff, or marks it FAILED when that was its last
// attempt. `final` tells the caller which, so the last failure is never silent.
export async function failJob(id: string, error: unknown, now: Date): Promise<{ final: boolean; attempts: number }> {
  const job = await db.job.findUniqueOrThrow({ where: { id }, select: { attempts: true, kind: true } });
  const lastError = describeError(error);
  const { maxAttempts, backoffMinutes } = retryPolicy(job.kind);
  if (job.attempts >= maxAttempts) {
    await db.job.update({ where: { id }, data: { status: "FAILED", lockedAt: null, lastError, finishedAt: now } });
    return { final: true, attempts: job.attempts };
  }
  const delay = backoffMinutes[job.attempts - 1] ?? backoffMinutes[backoffMinutes.length - 1] ?? 30;
  await db.job.update({
    where: { id },
    data: { status: "QUEUED", lockedAt: null, lastError, runAt: new Date(now.getTime() + delay * 60_000) },
  });
  return { final: false, attempts: job.attempts };
}
