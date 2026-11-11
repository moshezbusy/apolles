import { enqueue } from "./queue";
import type { JobKind } from "./kinds";

// Jobs that run on a schedule. Daily ones at 02:00 UTC, hourly ones at the start of each hour.
// The dedupe key makes ensureDailyJobs safe to call every few seconds: each is created once.
export const DAILY_KINDS: readonly JobKind[] = ["content.regions", "content.catalog", "content.inactive", "supplier-log.cleanup"];
export const HOURLY_KINDS: readonly JobKind[] = ["search.cleanup"];

export async function ensureDailyJobs(now: Date): Promise<void> {
  const day = now.toISOString().slice(0, 10);
  const hour = now.toISOString().slice(0, 13);
  for (const kind of DAILY_KINDS) {
    await enqueue(kind, {}, { runAt: new Date(`${day}T02:00:00.000Z`), dedupeKey: `${kind}:${day}` });
  }
  for (const kind of HOURLY_KINDS) {
    await enqueue(kind, {}, { runAt: new Date(`${hour}:00:00.000Z`), dedupeKey: `${kind}:${hour}` });
  }
}
