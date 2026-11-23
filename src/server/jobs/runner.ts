import type { Job } from "@/generated/prisma/client";
import { JOB_KINDS, retryPolicy, type JobKind } from "./kinds";
import { claimNext, completeJob, failAbandoned, failJob, heartbeat, type Lane } from "./queue";

export type JobHandler = (payload: unknown) => Promise<void>;
export type Handlers = Partial<Record<JobKind, JobHandler>>;
// Called once for a job that failed for the last time (or was abandoned on its last attempt).
export type FinalFailureHandler = (job: Pick<Job, "id" | "kind" | "payload">) => Promise<void>;

// Only a known kind's own handler runs; a kind read from the database is never used to pick
// an arbitrary property of the handlers object.
function handlerFor(handlers: Handlers, kind: string): JobHandler | undefined {
  const known = JOB_KINDS.find((k) => k === kind);
  return known && Object.hasOwn(handlers, known) ? new Map(Object.entries(handlers)).get(known) : undefined;
}

const HEARTBEAT_MS = 2 * 60_000;
const MAX_LOG_LENGTH = 300;

// The error for the log: its class and message on one line, at most 300 characters, with
// anything that looks like an email address masked. Our own errors carry no personal data or
// tokens (supplier errors hold only a status); the mask is for an error from somewhere else.
export function errorForLog(error: unknown): string {
  const name = error instanceof Error ? error.name : "Error";
  const message = error instanceof Error ? error.message : String(error);
  return `${name}: ${message}`
    .replace(/\s+/g, " ")
    .replace(/[^\s@<>"']+@[^\s@<>"']+/g, "[email]")
    .slice(0, MAX_LOG_LENGTH);
}

function logFailure(job: Pick<Job, "id" | "kind" | "attempts">, final: boolean, what: string): void {
  console.error(`job failed: ${job.kind} ${job.id} attempt ${job.attempts} of ${retryPolicy(job.kind).maxAttempts}, ${final ? "final" : "will retry"}: ${what}`);
}

// Claims and runs due jobs one at a time until none is left (or `shouldStop` says so). Each
// claim uses a fresh clock reading, and a running job's lock is refreshed every 2 minutes, so
// a long job is never reclaimed by another worker while it is alive. A handler's error never
// stops the run: the job is put back with a backoff by failJob. Every failure is logged (kind,
// id, attempt, the error), and a job that failed for the last time is handed to
// `onFinalFailure`, so nothing a job was meant to do is ever dropped without a trace.
export async function runPending(
  now: () => Date,
  handlers: Handlers,
  shouldStop: () => boolean = () => false,
  opts: { heartbeatMs?: number; clock?: () => Date; lane?: Lane; onFinalFailure?: FinalFailureHandler } = {},
): Promise<number> {
  const clock = opts.clock ?? now;
  const lastWords = async (job: Pick<Job, "id" | "kind" | "payload">) => {
    if (!opts.onFinalFailure) return;
    try {
      await opts.onFinalFailure(job);
    } catch (error) {
      console.error(`job final-failure step failed: ${job.kind} ${job.id}: ${errorForLog(error)}`);
    }
  };
  let ran = 0;
  while (!shouldStop()) {
    for (const gone of await failAbandoned(now())) {
      logFailure(gone, true, "abandoned, the worker stopped during the last attempt");
      await lastWords(gone);
    }
    const job = await claimNext(now(), opts.lane ?? "all");
    if (!job) break;
    ran++;
    const handler = handlerFor(handlers, job.kind);
    const beat = setInterval(() => {
      heartbeat(job.id, clock()).catch(() => console.error("job heartbeat failed"));
    }, opts.heartbeatMs ?? HEARTBEAT_MS);
    try {
      if (!handler) throw new Error(`no handler for job kind ${job.kind}`);
      await handler(job.payload);
      await completeJob(job.id);
    } catch (error) {
      const { final } = await failJob(job.id, error, now());
      logFailure(job, final, errorForLog(error));
      if (final) await lastWords(job);
    } finally {
      clearInterval(beat);
    }
  }
  return ran;
}
