// The background worker (spec section 7): a separate process from the same codebase.
// Three loops run side by side:
//   the scheduler   every 15 seconds makes sure the scheduled jobs exist (daily, hourly, the
//                   10-minute booking sweep). On its own timer: a long job never delays it.
//   short jobs      every 5 seconds runs every due booking, money, email and cleanup job.
//   long jobs       every 5 seconds runs the due long jobs (content syncs, the daily supplier
//                   check, the daily cleanup), so a sync that takes an hour never holds up a
//                   booking check or an email.
// Each job is claimed with FOR UPDATE SKIP LOCKED, so the two job loops (and a second worker
// process) never run the same job. On SIGTERM or SIGINT each loop finishes the job in hand and
// the process exits 0. Run with `pnpm worker`.
import { HANDLERS, onFinalFailure } from "@/server/jobs/handlers";
import type { Lane } from "@/server/jobs/queue";
import { runPending } from "@/server/jobs/runner";
import { ensureDailyJobs } from "@/server/jobs/schedule";

const TICK_MS = 5_000;
const SCHEDULE_MS = 15_000;

// Same rule as the app container's entrypoint: a production build runs only as staging or
// production, never by accident with another setting.
if (process.env.NODE_ENV === "production" && !["staging", "production"].includes(process.env.APP_ENV ?? "")) {
  console.error("Refusing to start: APP_ENV must be staging or production.");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("Refusing to start: DATABASE_URL is not set.");
  process.exit(1);
}
let stopping = false;

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    stopping = true;
  });
}

// Runs `step` again and again, `everyMs` apart, until the worker is asked to stop.
async function loop(name: string, everyMs: number, step: () => Promise<unknown>): Promise<void> {
  while (!stopping) {
    try {
      await step();
    } catch (error) {
      // A database hiccup must not kill the worker; the next tick tries again.
      console.error(`worker ${name} tick failed: ${error instanceof Error ? error.name : "Error"}`);
    }
    for (let waited = 0; waited < everyMs && !stopping; waited += 250) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

const jobs = (lane: Lane) => () => runPending(() => new Date(), HANDLERS, () => stopping, { lane, onFinalFailure });

async function main(): Promise<void> {
  console.info("Apolles worker started.");
  await Promise.all([loop("scheduler", SCHEDULE_MS, () => ensureDailyJobs(new Date())), loop("short jobs", TICK_MS, jobs("short")), loop("long jobs", TICK_MS, jobs("long"))]);
  console.info("Apolles worker stopped.");
}

main().then(
  () => process.exit(0),
  () => process.exit(1),
);
