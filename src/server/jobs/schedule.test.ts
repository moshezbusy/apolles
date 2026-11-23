import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { resetTestDb } from "@/test/db";
import { DAILY_KINDS, HOURLY_KINDS, ensureDailyJobs } from "./schedule";
import { HANDLERS } from "./handlers";

describe("ensureDailyJobs", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("creates one job of each daily kind per UTC day, at 02:00, never twice", async () => {
    const now = new Date("2027-03-01T10:00:00.000Z");
    await ensureDailyJobs(now);
    await ensureDailyJobs(now);
    const jobs = await db.job.findMany({ where: { kind: { in: [...DAILY_KINDS] } }, orderBy: { kind: "asc" } });
    expect(jobs).toHaveLength(DAILY_KINDS.length);
    for (const job of jobs) {
      expect(job.dedupeKey).toBe(`${job.kind}:2027-03-01`);
      expect(job.runAt.toISOString()).toBe("2027-03-01T02:00:00.000Z");
    }
  });

  it("the next day adds a new set", async () => {
    await ensureDailyJobs(new Date("2027-03-01T10:00:00.000Z"));
    await ensureDailyJobs(new Date("2027-03-02T00:30:00.000Z"));
    expect(await db.job.count({ where: { kind: { in: [...DAILY_KINDS] } } })).toBe(DAILY_KINDS.length * 2);
  });

  it("search cleanup and the free-cancellation reminders run every hour, once per hour", async () => {
    await ensureDailyJobs(new Date("2027-03-01T10:05:00.000Z"));
    await ensureDailyJobs(new Date("2027-03-01T10:55:00.000Z"));
    await ensureDailyJobs(new Date("2027-03-01T11:01:00.000Z"));
    const hourly = await db.job.findMany({ where: { kind: { in: [...HOURLY_KINDS] } }, orderBy: [{ runAt: "asc" }, { kind: "asc" }] });
    expect(hourly.map((j) => j.dedupeKey)).toEqual([
      "booking.cancel-reminders:2027-03-01T10",
      "search.cleanup:2027-03-01T10",
      "booking.cancel-reminders:2027-03-01T11",
      "search.cleanup:2027-03-01T11",
    ]);
  });
  it("the booking sweep runs every 10 minutes, once per 10 minutes", async () => {
    for (const time of ["10:00:00", "10:04:59", "10:09:59", "10:10:00", "10:27:30"]) await ensureDailyJobs(new Date(`2027-03-01T${time}.000Z`));
    const sweeps = await db.job.findMany({ where: { kind: "booking.sweep" }, orderBy: { runAt: "asc" } });
    expect(sweeps.map((j) => [j.dedupeKey, j.runAt.toISOString()])).toEqual([
      ["booking.sweep:2027-03-01T10:00", "2027-03-01T10:00:00.000Z"],
      ["booking.sweep:2027-03-01T10:10", "2027-03-01T10:10:00.000Z"],
      ["booking.sweep:2027-03-01T10:20", "2027-03-01T10:20:00.000Z"],
    ]);
  });

  it("confirmed bookings are checked at the supplier twice a day: all of the next 14 days at 03:00, the ones about to check in again at 15:00", async () => {
    await ensureDailyJobs(new Date("2027-03-01T00:10:00.000Z"));
    await ensureDailyJobs(new Date("2027-03-01T16:00:00.000Z"));
    const jobs = await db.job.findMany({ where: { kind: "booking.supplier-check" }, orderBy: { runAt: "asc" } });
    expect(jobs.map((j) => [j.dedupeKey, j.runAt.toISOString(), j.payload])).toEqual([
      ["booking.supplier-check:2027-03-01:window", "2027-03-01T03:00:00.000Z", { scope: "window" }],
      ["booking.supplier-check:2027-03-01:eve", "2027-03-01T15:00:00.000Z", { scope: "eve" }],
    ]);
  });

  it("every scheduled job has a handler that accepts its payload shape", async () => {
    await ensureDailyJobs(new Date("2027-03-01T10:00:00.000Z"));
    const kinds = new Set((await db.job.findMany()).map((j) => j.kind));
    for (const kind of kinds) expect(Object.hasOwn(HANDLERS, kind), kind).toBe(true);
    expect(kinds).toContain("cleanup.daily");
  });
});
