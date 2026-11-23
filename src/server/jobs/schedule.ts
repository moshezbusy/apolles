import type { Prisma } from "@/generated/prisma/client";
import { enqueue } from "./queue";
import type { JobKind } from "./kinds";

// Jobs that run on a schedule. Daily ones at 02:00 UTC, hourly ones at the start of each hour,
// the booking sweep every 10 minutes. The dedupe key makes ensureDailyJobs safe to call every
// few seconds: each is created once. The worker calls it from its own timer (src/worker.ts), so
// a long job never makes it skip an hour.
export const DAILY_KINDS: readonly JobKind[] = ["content.regions", "content.catalog", "content.inactive", "supplier-log.cleanup", "cleanup.daily"];
export const HOURLY_KINDS: readonly JobKind[] = ["search.cleanup", "booking.cancel-reminders"];
// Confirmed bookings are read at the supplier at 03:00 UTC (every booking checking in within 14
// days) and once more at 15:00 UTC (the ones checking in today or tomorrow).
export const SUPPLIER_CHECKS: readonly { hour: string; scope: "window" | "eve" }[] = [
  { hour: "03", scope: "window" },
  { hour: "15", scope: "eve" },
];
export const SWEEP_EVERY_MINUTES = 10;

export async function ensureDailyJobs(now: Date): Promise<void> {
  const iso = now.toISOString();
  const day = iso.slice(0, 10);
  const hour = iso.slice(0, 13);
  const at = async (kind: JobKind, payload: Prisma.InputJsonObject, runAt: string, key: string) => {
    await enqueue(kind, payload, { runAt: new Date(runAt), dedupeKey: `${kind}:${key}` });
  };
  for (const kind of DAILY_KINDS) await at(kind, {}, `${day}T02:00:00.000Z`, day);
  for (const { hour: h, scope } of SUPPLIER_CHECKS) await at("booking.supplier-check", { scope }, `${day}T${h}:00:00.000Z`, `${day}:${scope}`);
  for (const kind of HOURLY_KINDS) await at(kind, {}, `${hour}:00:00.000Z`, hour);
  // "2027-03-01T10:4": the 10 minutes this moment is in.
  const slot = iso.slice(0, 15);
  await at("booking.sweep", {}, `${slot}0:00.000Z`, `${slot}0`);
}
