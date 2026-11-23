import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { resetTestDb } from "@/test/db";
import { enqueue } from "./queue";
import { runPending } from "./runner";

const NOW = new Date("2027-03-01T10:00:00.000Z");

describe("runPending", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("runs every due job with its handler and marks it DONE", async () => {
    const handler = vi.fn(async () => {});
    await enqueue("search.cleanup", { a: 1 }, { runAt: NOW });
    await enqueue("search.cleanup", { a: 2 }, { runAt: NOW });
    const ran = await runPending(() => NOW, { "search.cleanup": handler });
    expect(ran).toBe(2);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(await db.job.count({ where: { status: "DONE" } })).toBe(2);
  });

  it("a handler that throws puts the job back with a backoff, and the run goes on", async () => {
    await enqueue("search.cleanup", {}, { runAt: NOW });
    await enqueue("content.inactive", {}, { runAt: NOW });
    const ran = await runPending(() => NOW, {
      "search.cleanup": async () => {
        throw new Error("boom");
      },
      "content.inactive": async () => {},
    });
    expect(ran).toBe(2);
    const failed = await db.job.findFirstOrThrow({ where: { kind: "search.cleanup" } });
    expect(failed).toMatchObject({ status: "QUEUED", lastError: "Error: boom" });
    expect(await db.job.count({ where: { kind: "content.inactive", status: "DONE" } })).toBe(1);
  });

  it("a job of a kind with no handler fails (and is not retried forever)", async () => {
    await enqueue("content.catalog", {}, { runAt: NOW });
    await runPending(() => NOW, {});
    const job = await db.job.findFirstOrThrow();
    expect(job.lastError).toMatch(/no handler/);
  });

  it("a job that runs long keeps its lock fresh (heartbeat), so it is never reclaimed while alive", async () => {
    const { id } = await enqueue("search.cleanup", {}, { runAt: NOW });
    let lockedDuringRun: Date | null = null;
    await runPending(
      () => NOW,
      {
        "search.cleanup": async () => {
          await new Promise((resolve) => setTimeout(resolve, 120));
          lockedDuringRun = (await db.job.findUniqueOrThrow({ where: { id } })).lockedAt;
        },
      },
      () => false,
      { heartbeatMs: 30, clock: () => new Date(NOW.getTime() + 40 * 60_000) },
    );
    expect(lockedDuringRun).not.toBeNull();
    expect(lockedDuringRun!.getTime()).toBeGreaterThan(NOW.getTime());
  });

  describe("failures are never silent", () => {
    afterEach(() => vi.restoreAllMocks());

    it("every handler failure is logged with the kind, id and attempt; an email address in the message is masked", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const { id } = await enqueue("search.cleanup", {}, { runAt: NOW });
      await runPending(() => NOW, { "search.cleanup": async () => { throw new TypeError("could not send to dana@example.com"); } });
      expect(log).toHaveBeenCalledTimes(1);
      const line = String(log.mock.calls[0]![0]);
      expect(line).toBe(`job failed: search.cleanup ${id} attempt 1 of 3, will retry: TypeError: could not send to [email]`);
    });

    it("the last failure is logged as final and handed to onFinalFailure, once", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const { id } = await enqueue("booking.reconcile", { bookingId: "bk-1" }, { runAt: NOW });
      await db.job.update({ where: { id }, data: { attempts: 2 } });
      const final = vi.fn(async () => {});
      await runPending(() => NOW, { "booking.reconcile": async () => { throw new Error("boom"); } }, () => false, { onFinalFailure: final });
      expect(final).toHaveBeenCalledTimes(1);
      expect(final).toHaveBeenCalledWith(expect.objectContaining({ id, kind: "booking.reconcile", payload: { bookingId: "bk-1" } }));
      expect(String(log.mock.calls[0]![0])).toBe(`job failed: booking.reconcile ${id} attempt 3 of 3, final: Error: boom`);
      expect((await db.job.findUniqueOrThrow({ where: { id } })).status).toBe("FAILED");
    });

    it("a failure that will be retried is not handed to onFinalFailure", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      await enqueue("booking.reconcile", { bookingId: "bk-1" }, { runAt: NOW });
      const final = vi.fn(async () => {});
      await runPending(() => NOW, { "booking.reconcile": async () => { throw new Error("boom"); } }, () => false, { onFinalFailure: final });
      expect(final).not.toHaveBeenCalled();
    });

    it("a job abandoned on its last attempt (the worker died) is logged and handed to onFinalFailure too", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const { id } = await enqueue("booking.reconcile", { bookingId: "bk-1" }, { runAt: NOW });
      await db.job.update({ where: { id }, data: { status: "RUNNING", attempts: 3, lockedAt: new Date(NOW.getTime() - 11 * 60_000) } });
      const final = vi.fn(async () => {});
      expect(await runPending(() => NOW, {}, () => false, { onFinalFailure: final })).toBe(0);
      expect(final).toHaveBeenCalledWith(expect.objectContaining({ id, kind: "booking.reconcile" }));
      expect(String(log.mock.calls[0]![0])).toBe(`job failed: booking.reconcile ${id} attempt 3 of 3, final: abandoned, the worker stopped during the last attempt`);
    });

    it("an onFinalFailure that throws never stops the run", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const first = await enqueue("booking.reconcile", { bookingId: "bk-1" }, { runAt: NOW });
      await db.job.update({ where: { id: first.id }, data: { attempts: 2 } });
      await enqueue("search.cleanup", {}, { runAt: new Date(NOW.getTime() + 1) });
      const ran = await runPending(() => new Date(NOW.getTime() + 1), { "booking.reconcile": async () => { throw new Error("boom"); }, "search.cleanup": async () => {} }, () => false, { onFinalFailure: async () => { throw new Error("flag failed"); } });
      expect(ran).toBe(2);
      expect(await db.job.count({ where: { kind: "search.cleanup", status: "DONE" } })).toBe(1);
    });
  });

  it("a lane runs only its own jobs", async () => {
    const ranKinds: string[] = [];
    await enqueue("content.inactive", {}, { runAt: NOW });
    await enqueue("search.cleanup", {}, { runAt: NOW });
    const handlers = { "content.inactive": async () => { ranKinds.push("content.inactive"); }, "search.cleanup": async () => { ranKinds.push("search.cleanup"); } };
    expect(await runPending(() => NOW, handlers, () => false, { lane: "long" })).toBe(1);
    expect(ranKinds).toEqual(["content.inactive"]);
    expect(await runPending(() => NOW, handlers, () => false, { lane: "short" })).toBe(1);
    expect(ranKinds).toEqual(["content.inactive", "search.cleanup"]);
  });

  it("stops when asked to, between jobs", async () => {
    await enqueue("search.cleanup", {}, { runAt: NOW });
    await enqueue("search.cleanup", {}, { runAt: NOW });
    let stop = false;
    const ran = await runPending(() => NOW, { "search.cleanup": async () => { stop = true; } }, () => stop);
    expect(ran).toBe(1);
  });
});
