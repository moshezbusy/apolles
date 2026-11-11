import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { resetTestDb } from "@/test/db";
import { DAILY_KINDS, HOURLY_KINDS, ensureDailyJobs } from "./schedule";

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

  it("search cleanup runs every hour, once per hour", async () => {
    await ensureDailyJobs(new Date("2027-03-01T10:05:00.000Z"));
    await ensureDailyJobs(new Date("2027-03-01T10:55:00.000Z"));
    await ensureDailyJobs(new Date("2027-03-01T11:01:00.000Z"));
    const cleanup = await db.job.findMany({ where: { kind: { in: [...HOURLY_KINDS] } }, orderBy: { runAt: "asc" } });
    expect(cleanup.map((j) => j.dedupeKey)).toEqual(["search.cleanup:2027-03-01T10", "search.cleanup:2027-03-01T11"]);
  });
});
