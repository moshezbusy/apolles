import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { resetTestDb } from "@/test/db";
import { claimNext, completeJob, enqueue, failAbandoned, failJob } from "./queue";

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
    expect(await failJob(id, new Error("boom"), NOW)).toEqual({ final: false, attempts: 1 });
    let job = await db.job.findUniqueOrThrow({ where: { id } });
    expect(job).toMatchObject({ status: "QUEUED", attempts: 1, lockedAt: null });
    expect(job.runAt).toEqual(minutes(1));

    await claimNext(minutes(1));
    await failJob(id, new Error("boom"), minutes(1));
    job = await db.job.findUniqueOrThrow({ where: { id } });
    expect(job.runAt).toEqual(minutes(6));

    await claimNext(minutes(6));
    expect(await failJob(id, new Error("boom"), minutes(6))).toEqual({ final: true, attempts: 3 });
    job = await db.job.findUniqueOrThrow({ where: { id } });
    expect(job.status).toBe("FAILED");
    expect(job.attempts).toBe(3);
    expect(await claimNext(minutes(60))).toBeNull();
  });

  it("booking and money jobs stay fast: a reconcile is tried again after 1, then 5 minutes", async () => {
    const { id } = await enqueue("booking.reconcile", { bookingId: "b" }, { runAt: NOW });
    await claimNext(NOW);
    await failJob(id, new Error("boom"), NOW);
    expect((await db.job.findUniqueOrThrow({ where: { id } })).runAt).toEqual(minutes(1));
  });

  it("an email job is tried 8 times over more than 24 hours before it is final", async () => {
    for (const kind of ["email.booking", "email.topup", "email.low-balance"] as const) {
      await resetTestDb();
      const { id } = await enqueue(kind, {}, { runAt: NOW });
      let at = NOW;
      const waits: number[] = [];
      for (let attempt = 1; attempt <= 8; attempt++) {
        expect((await claimNext(at))?.id, `${kind} attempt ${attempt}`).toBe(id);
        const outcome = await failJob(id, new Error("mail provider down"), at);
        expect(outcome).toEqual({ final: attempt === 8, attempts: attempt });
        if (outcome.final) break;
        const next = (await db.job.findUniqueOrThrow({ where: { id } })).runAt;
        waits.push((next.getTime() - at.getTime()) / 60_000);
        at = next;
      }
      expect(waits).toEqual([1, 5, 30, 120, 240, 360, 720]);
      expect(at.getTime() - NOW.getTime()).toBeGreaterThanOrEqual(24 * 3_600_000);
      expect((await db.job.findUniqueOrThrow({ where: { id } })).status).toBe("FAILED");
    }
  });

  it("a short job still RUNNING 10 minutes after it was claimed is claimed again", async () => {
    const { id } = await enqueue("booking.reconcile", { bookingId: "b" }, { runAt: NOW });
    await claimNext(NOW);
    expect(await claimNext(minutes(9))).toBeNull();
    const again = await claimNext(minutes(11));
    expect(again?.id).toBe(id);
  });

  it("a content sync is given 30 minutes before it counts as abandoned", async () => {
    const { id } = await enqueue("content.catalog", {}, { runAt: NOW });
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

  it("failAbandoned returns the jobs it gave up on, each once; an email job only after its 8 attempts", async () => {
    const reconcile = await enqueue("booking.reconcile", { bookingId: "b1" }, { runAt: NOW });
    const email = await enqueue("email.booking", {}, { runAt: NOW });
    await db.job.updateMany({ data: { status: "RUNNING", attempts: 3, lockedAt: NOW } });
    const gone = await failAbandoned(minutes(11));
    expect(gone.map((j) => [j.id, j.kind, j.payload])).toEqual([[reconcile.id, "booking.reconcile", { bookingId: "b1" }]]);
    expect(await failAbandoned(minutes(11))).toEqual([]);
    // The email job has attempts left: it is claimed again instead.
    expect((await claimNext(minutes(11)))?.id).toBe(email.id);
  });

  it("booking, money and email jobs are claimed before long jobs that are due, whatever their order", async () => {
    const content = await enqueue("content.catalog", {}, { runAt: minutes(-600) });
    const check = await enqueue("booking.supplier-check", {}, { runAt: minutes(-500) });
    const reconcile = await enqueue("booking.reconcile", { bookingId: "b" }, { runAt: minutes(-1) });
    const email = await enqueue("email.booking", {}, { runAt: NOW });
    const order = [];
    for (let i = 0; i < 4; i++) order.push((await claimNext(NOW))?.id);
    expect(order).toEqual([reconcile.id, email.id, content.id, check.id]);
  });

  it("a lane claims only its own jobs: long jobs in one, everything else in the other", async () => {
    const content = await enqueue("content.catalog", {}, { runAt: NOW });
    const reconcile = await enqueue("booking.reconcile", { bookingId: "b" }, { runAt: NOW });
    expect((await claimNext(NOW, "long"))?.id).toBe(content.id);
    expect(await claimNext(NOW, "long")).toBeNull();
    expect((await claimNext(NOW, "short"))?.id).toBe(reconcile.id);
    expect(await claimNext(NOW, "short")).toBeNull();
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
