import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { resetTestDb } from "@/test/db";
import { claimNext, completeJob, enqueue, failJob } from "./queue";

const NOW = new Date("2027-03-01T10:00:00.000Z");
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

describe("job queue", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("enqueue twice with the same dedupeKey → one row, second call created=false", async () => {
    const first = await enqueue("search.cleanup", {}, { runAt: NOW, dedupeKey: "search.cleanup:2027-03-01" });
    const second = await enqueue("search.cleanup", {}, { runAt: NOW, dedupeKey: "search.cleanup:2027-03-01" });
    expect(first.created).toBe(true);
    expect(second).toEqual({ id: first.id, created: false });
    expect(await db.job.count()).toBe(1);
  });

  it("two concurrent claimNext with one queued job → exactly one gets it", async () => {
    await enqueue("search.cleanup", {}, { runAt: NOW });
    const [a, b] = await Promise.all([claimNext(NOW), claimNext(NOW)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    const job = await db.job.findFirstOrThrow();
    expect(job.status).toBe("RUNNING");
    expect(job.attempts).toBe(1);
  });

  it("a job with runAt in the future is not claimed", async () => {
    await enqueue("search.cleanup", {}, { runAt: minutes(5) });
    expect(await claimNext(NOW)).toBeNull();
  });

  it("failJob → QUEUED again with backoff 1, 5 min; the third failure → FAILED", async () => {
    const { id } = await enqueue("search.cleanup", {}, { runAt: NOW });
    await claimNext(NOW);
    await failJob(id, new Error("boom"), NOW);
    let job = await db.job.findUniqueOrThrow({ where: { id } });
    expect(job).toMatchObject({ status: "QUEUED", attempts: 1, lockedAt: null });
    expect(job.runAt).toEqual(minutes(1));

    await claimNext(minutes(1));
    await failJob(id, new Error("boom"), minutes(1));
    job = await db.job.findUniqueOrThrow({ where: { id } });
    expect(job.runAt).toEqual(minutes(6));

    await claimNext(minutes(6));
    await failJob(id, new Error("boom"), minutes(6));
    job = await db.job.findUniqueOrThrow({ where: { id } });
    expect(job.status).toBe("FAILED");
    expect(job.attempts).toBe(3);
    expect(await claimNext(minutes(60))).toBeNull();
  });

  it("a RUNNING job locked more than 30 minutes ago is claimed again", async () => {
    const { id } = await enqueue("search.cleanup", {}, { runAt: NOW });
    await claimNext(NOW);
    expect(await claimNext(minutes(29))).toBeNull();
    const again = await claimNext(minutes(31));
    expect(again?.id).toBe(id);
  });

  it("an abandoned job that already used every attempt is marked FAILED, not run again", async () => {
    const { id } = await enqueue("search.cleanup", {}, { runAt: NOW });
    await db.job.update({ where: { id }, data: { status: "RUNNING", attempts: 3, lockedAt: NOW } });
    expect(await claimNext(minutes(31))).toBeNull();
    expect((await db.job.findUniqueOrThrow({ where: { id } })).status).toBe("FAILED");
  });

  it("lastError keeps the error class and at most 500 characters, never more", async () => {
    const { id } = await enqueue("search.cleanup", {}, { runAt: NOW });
    await claimNext(NOW);
    await failJob(id, new TypeError("x".repeat(2000)), NOW);
    const job = await db.job.findUniqueOrThrow({ where: { id } });
    expect(job.lastError?.startsWith("TypeError: ")).toBe(true);
    expect(job.lastError?.length).toBeLessThanOrEqual(500);
  });

  it("completeJob marks it DONE with a finish time", async () => {
    const { id } = await enqueue("search.cleanup", {}, { runAt: NOW });
    await claimNext(NOW);
    await completeJob(id);
    const job = await db.job.findUniqueOrThrow({ where: { id } });
    expect(job.status).toBe("DONE");
    expect(job.finishedAt).not.toBeNull();
  });
});
