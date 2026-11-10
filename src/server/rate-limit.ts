import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { normalizeEmail } from "@/server/users";

// Fixed-window rate limits, counted in Postgres (table RateLimitBucket), so every app server
// shares the same counters and nothing lives in memory.
//
// A window is [start, start + windowMs), with start = the database clock rounded down to a
// multiple of windowMs since 1970. Using the database clock (not the app server's) means app
// servers with skewed clocks still count into the same window.
// Each hit is ONE statement: INSERT ... ON CONFLICT DO UPDATE SET count = count + 1
// RETURNING count. Postgres runs parallel hits on one key one after another on the row, so
// each gets its own count and no more than `limit` hits per window are ever allowed.

const PRUNE_PROBABILITY = 0.01;
const MAX_KEY_LENGTH = 200;

export type RateLimitResult = { allowed: boolean; retryAfterMs: number };

export type HitRateLimitOptions = {
  // Source of randomness for the occasional prune (tests pass a fixed value).
  random?: () => number;
};

// The limits (owner-approved plan 1b, task 2). windowMs in milliseconds.
export const RATE_LIMITS = {
  signin: { limit: 10, windowMs: 15 * 60 * 1000 },
  totp: { limit: 10, windowMs: 15 * 60 * 1000 },
  forgot: { limit: 5, windowMs: 60 * 60 * 1000 },
  forgotEmail: { limit: 3, windowMs: 60 * 60 * 1000 },
  "set-password": { limit: 10, windowMs: 15 * 60 * 1000 },
} as const satisfies Record<string, { limit: number; windowMs: number }>;

// Actions limited per client IP.
export type IpRateLimitAction = "signin" | "totp" | "forgot" | "set-password";

// Shown when a sign-in or TOTP request is refused by the per-IP limit.
export const SIGN_IN_RATE_LIMIT_COPY =
  "Too many sign-in attempts from your network. Try again in 15 minutes.";
// Shown when a set-password submit is refused by the per-IP limit.
export const SET_PASSWORD_RATE_LIMIT_COPY = "Too many attempts. Try again later.";

export function ipKey(action: IpRateLimitAction, ip: string): string {
  return `${action}:ip:${ip}`;
}

// Never the raw email: a sha256 hex digest of the normalized address.
export function emailKey(email: string): string {
  return `forgot:email:${createHash("sha256").update(normalizeEmail(email)).digest("hex")}`;
}

// Start of the window `offset` windows after the current one, on the database clock, as a
// UTC timestamp like the column. Exported for the test helper that seeds buckets.
export function windowStartSql(windowMs: number, offset = 0): Prisma.Sql {
  return Prisma.sql`(to_timestamp(
      (floor(extract(epoch FROM now()) * 1000 / ${windowMs}::numeric) + ${offset}::int)
        * ${windowMs}::numeric / 1000
    ) AT TIME ZONE 'UTC')`;
}

function assertValid(key: string, limit: number, windowMs: number): void {
  if (key.length === 0 || key.length > MAX_KEY_LENGTH) throw new Error("hitRateLimit: bad key");
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("hitRateLimit: bad limit");
  if (!Number.isSafeInteger(windowMs) || windowMs < 1) throw new Error("hitRateLimit: bad window");
}

// Counts one hit for `key` in the current window. allowed = this hit is within `limit`.
// windowMs should be at most 24 hours: the occasional prune deletes buckets whose window
// started more than 24 hours ago, which would reset a longer window early.
// retryAfterMs = time left until the window ends (database clock). A refused hit is still
// counted (the counter only grows within a window).
export async function hitRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  { random = Math.random }: HitRateLimitOptions = {},
): Promise<RateLimitResult> {
  assertValid(key, limit, windowMs);
  const rows = await db.$queryRaw<{ count: number; retryAfterMs: number }[]>`
    INSERT INTO "RateLimitBucket" ("key", "windowStart", "count")
    VALUES (${key}, ${windowStartSql(windowMs)}, 1)
    ON CONFLICT ("key", "windowStart") DO UPDATE SET "count" = "RateLimitBucket"."count" + 1
    RETURNING "count",
      (extract(epoch FROM ("windowStart" AT TIME ZONE 'UTC')) * 1000 + ${windowMs}::numeric
        - extract(epoch FROM now()) * 1000)::float8 AS "retryAfterMs"`;
  const row = rows[0];
  if (!row) throw new Error("hitRateLimit: no row returned");

  if (random() < PRUNE_PROBABILITY) await pruneOldBuckets();

  return { allowed: row.count <= limit, retryAfterMs: Math.max(0, Math.ceil(row.retryAfterMs)) };
}

// Best effort: an error here must not fail the request that triggered it (the count above is
// already saved). The key is not logged (it holds an IP).
async function pruneOldBuckets(): Promise<void> {
  try {
    await db.$executeRaw`
      DELETE FROM "RateLimitBucket"
      WHERE "windowStart" < (now() AT TIME ZONE 'UTC') - interval '24 hours'`;
  } catch (error) {
    console.error("rate limit prune failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// Counts one request of `action` from `ip` against that action's limit.
export async function hitIpRateLimit(action: IpRateLimitAction, ip: string): Promise<RateLimitResult> {
  const { limit, windowMs } = RATE_LIMITS[action];
  return hitRateLimit(ipKey(action, ip), limit, windowMs);
}
