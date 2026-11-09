import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { resetTestDb } from "@/test/db";
import { RATE_LIMITS, emailKey, hitRateLimit, ipKey } from "@/server/rate-limit";

// Deterministic: the window start comes from the database clock, so instead of faking time
// these tests either use a window so long that no boundary can fall inside a test run
// (HUGE: 100 years, current window ends in 2069), or move a bucket back one window in the
// database to stand for "the window has passed".
const HUGE = 100 * 365 * 24 * 60 * 60 * 1000;
const FIFTEEN_MINUTES = 15 * 60 * 1000;
const NEVER_PRUNE = { random: () => 0.99 };

async function buckets() {
  return db.rateLimitBucket.findMany({ orderBy: { windowStart: "asc" } });
}

describe("hitRateLimit", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("allows up to the limit in one window, then refuses", async () => {
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await hitRateLimit("t:ip:1", 3, HUGE, NEVER_PRUNE));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    const rows = await buckets();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.count).toBe(4);
  });

  it("keys are counted separately", async () => {
    for (let i = 0; i < 3; i++) await hitRateLimit("t:ip:1", 3, HUGE, NEVER_PRUNE);
    expect((await hitRateLimit("t:ip:1", 3, HUGE, NEVER_PRUNE)).allowed).toBe(false);
    expect((await hitRateLimit("t:ip:2", 3, HUGE, NEVER_PRUNE)).allowed).toBe(true);
  });

  it("a new window allows again", async () => {
    for (let i = 0; i < 4; i++) await hitRateLimit("t:ip:1", 3, HUGE, NEVER_PRUNE);
    expect((await hitRateLimit("t:ip:1", 3, HUGE, NEVER_PRUNE)).allowed).toBe(false);
    // The window passes: the full bucket now belongs to the previous window.
    await db.$executeRaw`
      UPDATE "RateLimitBucket" SET "windowStart" = "windowStart" - ${HUGE}::bigint * interval '1 millisecond'`;
    const next = await hitRateLimit("t:ip:1", 3, HUGE, NEVER_PRUNE);
    expect(next.allowed).toBe(true);
    const rows = await buckets();
    expect(rows.map((r) => r.count)).toEqual([5, 1]);
  });

  it("window start is aligned to the window length on the database clock; retryAfterMs is the time left", async () => {
    const rows = await db.$queryRaw<{ dbNow: Date }[]>`SELECT now() AS "dbNow"`;
    const dbNow = rows[0]!.dbNow;
    const result = await hitRateLimit("t:ip:1", 10, FIFTEEN_MINUTES, NEVER_PRUNE);
    expect(result.allowed).toBe(true);
    const [row] = await buckets();
    const start = row!.windowStart.getTime();
    expect(start % FIFTEEN_MINUTES).toBe(0);
    expect(start).toBeLessThanOrEqual(dbNow.getTime() + 1000);
    expect(start + FIFTEEN_MINUTES).toBeGreaterThan(dbNow.getTime() - 1000);
    expect(result.retryAfterMs).toBeGreaterThan(0);
    expect(result.retryAfterMs).toBeLessThanOrEqual(FIFTEEN_MINUTES);
    // window end − database now, within a second of what the bucket implies
    expect(Math.abs(start + FIFTEEN_MINUTES - dbNow.getTime() - result.retryAfterMs)).toBeLessThan(1000);
  });

  it("parallel hits at the limit boundary: exactly `limit` are allowed", async () => {
    const limit = 5;
    const results = await Promise.all(
      Array.from({ length: limit + 1 }, () => hitRateLimit("t:ip:race", limit, HUGE, NEVER_PRUNE)),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(limit);
    expect((await buckets())[0]!.count).toBe(limit + 1);
  });

  it("two parallel hits when one slot is left: exactly one allowed", async () => {
    for (let i = 0; i < 2; i++) await hitRateLimit("t:ip:race", 3, HUGE, NEVER_PRUNE);
    const results = await Promise.all([
      hitRateLimit("t:ip:race", 3, HUGE, NEVER_PRUNE),
      hitRateLimit("t:ip:race", 3, HUGE, NEVER_PRUNE),
    ]);
    expect(results.filter((r) => r.allowed)).toHaveLength(1);
  });

  it("prune (about 1 call in 100): deletes buckets older than 24 hours, keeps newer ones", async () => {
    await db.$executeRaw`
      INSERT INTO "RateLimitBucket" ("key", "windowStart", "count") VALUES
        ('old', (now() AT TIME ZONE 'UTC') - interval '25 hours', 7),
        ('recent', (now() AT TIME ZONE 'UTC') - interval '23 hours', 7)`;
    await hitRateLimit("t:ip:1", 3, FIFTEEN_MINUTES, { random: () => 0.5 });
    expect((await buckets()).map((r) => r.key).sort()).toEqual(["old", "recent", "t:ip:1"]);
    await hitRateLimit("t:ip:1", 3, FIFTEEN_MINUTES, { random: () => 0.001 });
    expect((await buckets()).map((r) => r.key).sort()).toEqual(["recent", "t:ip:1"]);
  });

  it("rejects a bad limit, window or key (programming error)", async () => {
    await expect(hitRateLimit("k", 0, HUGE)).rejects.toThrow();
    await expect(hitRateLimit("k", 1.5, HUGE)).rejects.toThrow();
    await expect(hitRateLimit("k", 1, 0)).rejects.toThrow();
    await expect(hitRateLimit("", 1, HUGE)).rejects.toThrow();
  });
});

describe("rate-limit keys and limits", () => {
  it("ipKey: <action>:ip:<ip>", () => {
    expect(ipKey("signin", "203.0.113.7")).toBe("signin:ip:203.0.113.7");
    expect(ipKey("totp", "2001:db8::1")).toBe("totp:ip:2001:db8::1");
    expect(ipKey("forgot", "unknown")).toBe("forgot:ip:unknown");
    expect(ipKey("set-password", "203.0.113.7")).toBe("set-password:ip:203.0.113.7");
  });

  it("emailKey: sha256 hex of the normalized email, never the raw email", () => {
    const key = emailKey("  Agent@Example.COM ");
    expect(key).toBe(emailKey("agent@example.com"));
    expect(key).toMatch(/^forgot:email:[0-9a-f]{64}$/);
    expect(key).not.toContain("agent");
    expect(key).toBe("forgot:email:" + createHash("sha256").update("agent@example.com").digest("hex"));
  });

  it("limits from the brief", () => {
    expect(RATE_LIMITS).toEqual({
      signin: { limit: 10, windowMs: 15 * 60 * 1000 },
      totp: { limit: 10, windowMs: 15 * 60 * 1000 },
      forgot: { limit: 5, windowMs: 60 * 60 * 1000 },
      forgotEmail: { limit: 3, windowMs: 60 * 60 * 1000 },
      "set-password": { limit: 10, windowMs: 15 * 60 * 1000 },
    });
  });
});
