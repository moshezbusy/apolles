import { db } from "@/server/db";
import { windowStartSql } from "@/server/rate-limit";

// Test-only: makes `count` earlier hits for `key` in BOTH the current window and the next
// one (database clock). A test that then makes one request gets the same answer even if a
// window boundary passes in between, so no fake clock is needed.
export async function seedRateLimit(key: string, count: number, windowMs: number): Promise<void> {
  await db.$executeRaw`
    INSERT INTO "RateLimitBucket" ("key", "windowStart", "count") VALUES
      (${key}, ${windowStartSql(windowMs, 0)}, ${count}),
      (${key}, ${windowStartSql(windowMs, 1)}, ${count})`;
}
