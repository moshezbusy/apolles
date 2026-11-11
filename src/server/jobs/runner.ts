import type { JobKind } from "./kinds";
import { claimNext, completeJob, failJob } from "./queue";

export type JobHandler = (payload: unknown) => Promise<void>;
export type Handlers = Partial<Record<JobKind, JobHandler>>;

// Claims and runs due jobs one at a time until none is left (or `shouldStop` says so). A
// handler's error never stops the run: the job is put back with a backoff by failJob.
export async function runPending(now: Date, handlers: Handlers, shouldStop: () => boolean = () => false): Promise<number> {
  let ran = 0;
  while (!shouldStop()) {
    const job = await claimNext(now);
    if (!job) break;
    ran++;
    const handler = handlers[job.kind as JobKind];
    try {
      if (!handler) throw new Error(`no handler for job kind ${job.kind}`);
      await handler(job.payload);
      await completeJob(job.id);
    } catch (error) {
      await failJob(job.id, error, now);
    }
  }
  return ran;
}
