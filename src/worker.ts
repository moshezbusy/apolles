// The background worker (spec section 7): a separate process from the same codebase.
// Every 5 seconds it makes sure today's daily jobs exist, then runs every job that is due.
// On SIGTERM or SIGINT it finishes the job in hand and exits 0. Run with `pnpm worker`.
import { HANDLERS } from "@/server/jobs/handlers";
import { runPending } from "@/server/jobs/runner";
import { ensureDailyJobs } from "@/server/jobs/schedule";

const TICK_MS = 5_000;

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

async function main(): Promise<void> {
  console.info("Apolles worker started.");
  while (!stopping) {
    const now = new Date();
    try {
      await ensureDailyJobs(now);
      await runPending(() => new Date(), HANDLERS, () => stopping);
    } catch (error) {
      // A database hiccup must not kill the worker; the next tick tries again.
      console.error(`worker tick failed: ${error instanceof Error ? error.name : "Error"}`);
    }
    for (let waited = 0; waited < TICK_MS && !stopping; waited += 250) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  console.info("Apolles worker stopped.");
}

main().then(
  () => process.exit(0),
  () => process.exit(1),
);
