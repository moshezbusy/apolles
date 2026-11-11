import { enqueue } from "./queue";
import type { JobKind } from "./kinds";

// The jobs that run once a day, at 02:00 UTC. The dedupe key makes ensureDailyJobs safe to call
// every few seconds: it creates each day's jobs once.
export const DAILY_KINDS: readonly JobKind[] = ["content.regions", "content.catalog", "content.inactive", "search.cleanup"];

export async function ensureDailyJobs(now: Date): Promise<void> {
  const day = now.toISOString().slice(0, 10);
  const runAt = new Date(`${day}T02:00:00.000Z`);
  for (const kind of DAILY_KINDS) {
    await enqueue(kind, {}, { runAt, dedupeKey: `${kind}:${day}` });
  }
}
