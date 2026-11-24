import { removeOldAuthRequests } from "@/server/assistant/oauth";
import { expireOldDrafts } from "@/server/booking/upkeep";
import { db } from "@/server/db";
import { EMAIL_KINDS } from "./kinds";

// The daily cleanup (one job, "cleanup.daily"): rows that no longer serve anyone are removed, so
// personal data is not kept longer than needed and the tables do not grow for ever.
//   drafts          DRAFT bookings untouched for 7 days expire; their personal details are blanked.
//   sessions, passwordTokens, trustedDevices   rows past their expiry (they no longer work).
//   jobs            finished jobs after 30 days, failed ones after 90. An email job is kept: its
//                   key is what stops the same email from being sent a second time.
//   contentCache    hotel content fetched more than 30 days ago.
//   assistantSignIns AI assistant sign-ins (OAuth) that ended more than a day ago.
// Every delete works in batches of at most 1,000 rows, at most 50 batches a run; what is left
// goes with the next day's run. One part that fails does not stop the others; the run then
// fails as a whole, so the job is tried again and the failure is logged.

const DAY_MS = 86_400_000;
const DONE_JOBS_KEPT_MS = 30 * DAY_MS;
const FAILED_JOBS_KEPT_MS = 90 * DAY_MS;
// 30 days, not less: the public client page of a quote shows hotel photos from this cache only
// (it never asks the supplier), so content must outlive the time a quote stays open.
const CONTENT_CACHE_KEPT_MS = 30 * DAY_MS;
const BATCH_SIZE = 1_000;
const MAX_BATCHES = 50;

async function deleteInBatches(batchSize: number, find: (take: number) => Promise<string[]>, remove: (ids: string[]) => Promise<{ count: number }>): Promise<number> {
  let deleted = 0;
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const ids = await find(batchSize);
    if (ids.length === 0) break;
    deleted += (await remove(ids)).count;
    if (ids.length < batchSize) break;
  }
  return deleted;
}

export type CleanupCounts = { drafts: number; sessions: number; passwordTokens: number; trustedDevices: number; jobs: number; contentCache: number; assistantSignIns: number };

export async function dailyCleanup(now: Date = new Date(), opts: { batchSize?: number } = {}): Promise<CleanupCounts> {
  const size = opts.batchSize ?? BATCH_SIZE;
  const expired = { expiresAt: { lt: now } };
  const oldJobs = {
    AND: [
      { OR: [{ status: "DONE" as const, finishedAt: { lt: new Date(now.getTime() - DONE_JOBS_KEPT_MS) } }, { status: "FAILED" as const, finishedAt: { lt: new Date(now.getTime() - FAILED_JOBS_KEPT_MS) } }] },
      { OR: [{ dedupeKey: null }, { kind: { notIn: [...EMAIL_KINDS] } }] },
    ],
  };
  const oldContent = { fetchedAt: { lt: new Date(now.getTime() - CONTENT_CACHE_KEPT_MS) } };
  const parts: Record<keyof CleanupCounts, () => Promise<number>> = {
    drafts: () => expireOldDrafts(now),
    sessions: () =>
      deleteInBatches(size, async (take) => (await db.session.findMany({ where: expired, select: { id: true }, take })).map((r) => r.id), (ids) => db.session.deleteMany({ where: { id: { in: ids }, ...expired } })),
    passwordTokens: () =>
      deleteInBatches(size, async (take) => (await db.passwordToken.findMany({ where: expired, select: { id: true }, take })).map((r) => r.id), (ids) => db.passwordToken.deleteMany({ where: { id: { in: ids }, ...expired } })),
    trustedDevices: () =>
      deleteInBatches(size, async (take) => (await db.trustedDevice.findMany({ where: expired, select: { id: true }, take })).map((r) => r.id), (ids) => db.trustedDevice.deleteMany({ where: { id: { in: ids }, ...expired } })),
    jobs: () => deleteInBatches(size, async (take) => (await db.job.findMany({ where: oldJobs, select: { id: true }, take })).map((r) => r.id), (ids) => db.job.deleteMany({ where: { id: { in: ids }, ...oldJobs } })),
    contentCache: () =>
      deleteInBatches(
        size,
        async (take) => (await db.propertyContentCache.findMany({ where: oldContent, select: { propertyId: true }, take })).map((r) => r.propertyId),
        (ids) => db.propertyContentCache.deleteMany({ where: { propertyId: { in: ids }, ...oldContent } }),
      ),
    assistantSignIns: () => removeOldAuthRequests(now),
  };
  const counts: CleanupCounts = { drafts: 0, sessions: 0, passwordTokens: 0, trustedDevices: 0, jobs: 0, contentCache: 0, assistantSignIns: 0 };
  const failed: string[] = [];
  for (const name of Object.keys(parts) as (keyof CleanupCounts)[]) {
    try {
      counts[name] = await parts[name]();
    } catch (error) {
      failed.push(name);
      console.error(`daily cleanup: ${name} failed: ${error instanceof Error ? error.name : "Error"}`);
    }
  }
  console.info(`daily cleanup: ${Object.entries(counts).map(([name, n]) => `${name} ${n}`).join(", ")}`);
  if (failed.length > 0) throw new Error(`Daily cleanup: these parts failed: ${failed.join(", ")}`);
  return counts;
}
