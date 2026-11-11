import { beforeEach, describe, expect, it, vi } from "vitest";
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

  it("stops when asked to, between jobs", async () => {
    await enqueue("search.cleanup", {}, { runAt: NOW });
    await enqueue("search.cleanup", {}, { runAt: NOW });
    let stop = false;
    const ran = await runPending(() => NOW, { "search.cleanup": async () => { stop = true; } }, () => stop);
    expect(ran).toBe(1);
  });
});
