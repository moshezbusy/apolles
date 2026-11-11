import type { JobKind } from "./kinds";
import { claimNext, completeJob, failJob, heartbeat } from "./queue";

export type JobHandler = (payload: unknown) => Promise<void>;
export type Handlers = Partial<Record<JobKind, JobHandler>>;

const HEARTBEAT_MS = 5 * 60_000;

// Claims and runs due jobs one at a time until none is left (or `shouldStop` says so). Each
// claim uses a fresh clock reading, and a running job's lock is refreshed every 5 minutes, so
// a long job is never reclaimed by another worker while it is alive. A handler's error never
// stops the run: the job is put back with a backoff by failJob.
export async function runPending(
  now: () => Date,
  handlers: Handlers,
  shouldStop: () => boolean = () => false,
  opts: { heartbeatMs?: number; clock?: () => Date } = {},
): Promise<number> {
  const clock = opts.clock ?? now;
  let ran = 0;
  while (!shouldStop()) {
    const job = await claimNext(now());
    if (!job) break;
    ran++;
    const handler = handlers[job.kind as JobKind];
    const beat = setInterval(() => {
      heartbeat(job.id, clock()).catch(() => console.error("job heartbeat failed"));
    }, opts.heartbeatMs ?? HEARTBEAT_MS);
    try {
      if (!handler) throw new Error(`no handler for job kind ${job.kind}`);
      await handler(job.payload);
      await completeJob(job.id);
    } catch (error) {
      await failJob(job.id, error, now());
    } finally {
      clearInterval(beat);
    }
  }
  return ran;
}
