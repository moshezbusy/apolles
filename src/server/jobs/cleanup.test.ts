import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { resetTestDb } from "@/test/db";
import { dailyCleanup } from "./cleanup";

const NOW = new Date("2027-03-01T10:00:00.000Z");
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

describe("dailyCleanup", () => {
  beforeEach(async () => {
    await resetTestDb();
    await db.user.create({ data: { id: "u1", email: "a@test.local", name: "A", role: "ADMIN" } });
  });

  it("deletes expired sessions, password tokens and trusted devices, and keeps the live ones", async () => {
    await db.session.createMany({ data: [{ id: "s-old", tokenHash: "h1", userId: "u1", expiresAt: days(-1) }, { id: "s-live", tokenHash: "h2", userId: "u1", expiresAt: days(1) }] });
    await db.passwordToken.createMany({ data: [{ id: "p-old", tokenHash: "h3", userId: "u1", purpose: "RESET", expiresAt: days(-1) }, { id: "p-live", tokenHash: "h4", userId: "u1", purpose: "SET", expiresAt: days(1) }] });
    await db.trustedDevice.createMany({ data: [{ id: "t-old", tokenHash: "h5", userId: "u1", expiresAt: days(-1) }, { id: "t-live", tokenHash: "h6", userId: "u1", expiresAt: days(1) }] });
    const counts = await dailyCleanup(NOW);
    expect(counts).toMatchObject({ sessions: 1, passwordTokens: 1, trustedDevices: 1 });
    expect((await db.session.findMany()).map((r) => r.id)).toEqual(["s-live"]);
    expect((await db.passwordToken.findMany()).map((r) => r.id)).toEqual(["p-live"]);
    expect((await db.trustedDevice.findMany()).map((r) => r.id)).toEqual(["t-live"]);
  });

  it("deletes finished jobs after 30 days and failed ones after 90, but never an email job whose key stops a second send", async () => {
    const job = (id: string, kind: string, status: "DONE" | "FAILED" | "QUEUED", finishedAt: Date | null, dedupeKey: string | null = null) => ({ id, kind, payload: {}, status, runAt: days(-200), finishedAt, dedupeKey });
    await db.job.createMany({
      data: [
        job("done-old", "booking.reconcile", "DONE", days(-31), "booking.reconcile:b1:x"),
        job("done-new", "booking.reconcile", "DONE", days(-29), "booking.reconcile:b1:y"),
        job("daily-old", "content.catalog", "DONE", days(-40), "content.catalog:2027-01-20"),
        job("plain-old", "search.cleanup", "DONE", days(-40)),
        job("failed-old", "booking.reconcile", "FAILED", days(-91), "booking.reconcile:b2:x"),
        job("failed-new", "booking.reconcile", "FAILED", days(-60), "booking.reconcile:b2:y"),
        job("email-old", "email.booking", "DONE", days(-400), "email.booking:b1:confirmed"),
        job("email-failed-old", "email.topup", "FAILED", days(-400), "email.topup:e1"),
        job("queued-old", "booking.reconcile", "QUEUED", null, "booking.reconcile:b3:x"),
      ],
    });
    expect(await dailyCleanup(NOW)).toMatchObject({ jobs: 4 });
    expect((await db.job.findMany({ orderBy: { id: "asc" } })).map((j) => j.id)).toEqual(["done-new", "email-failed-old", "email-old", "failed-new", "queued-old"]);
  });

  it("deletes hotel content cached more than 30 days ago", async () => {
    await db.propertyContentCache.createMany({ data: [{ propertyId: "old", data: {}, fetchedAt: days(-31) }, { propertyId: "new", data: {}, fetchedAt: days(-29) }] });
    expect(await dailyCleanup(NOW)).toMatchObject({ contentCache: 1 });
    expect((await db.propertyContentCache.findMany()).map((r) => r.propertyId)).toEqual(["new"]);
  });

  it("works in bounded batches: more rows than one batch are all deleted", async () => {
    await db.session.createMany({ data: Array.from({ length: 25 }, (_, i) => ({ id: `s${i}`, tokenHash: `h${i}`, userId: "u1", expiresAt: days(-1) })) });
    expect(await dailyCleanup(NOW, { batchSize: 10 })).toMatchObject({ sessions: 25 });
    expect(await db.session.count()).toBe(0);
  });

  it("one part that fails does not stop the others; the run then fails with the names of the failed parts", async () => {
    await db.propertyContentCache.create({ data: { propertyId: "old", data: {}, fetchedAt: days(-31) } });
    const spy = vi.spyOn(db.session, "findMany").mockRejectedValueOnce(new Error("db hiccup"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(dailyCleanup(NOW)).rejects.toThrow("Daily cleanup: these parts failed: sessions");
    spy.mockRestore();
    log.mockRestore();
    expect(await db.propertyContentCache.count()).toBe(0);
  });

  it("deletes ended AI assistant sign-ins, unused registrations and long-ended connections", async () => {
    const DAY = 24 * 60 * 60 * 1000;
    const redirect = ["https://claude.ai/api/mcp/auth_callback"];
    await db.assistantClient.create({ data: { id: "apc_c", name: "Claude", redirectUris: redirect, createdAt: new Date(NOW.getTime() - 30 * DAY) } });
    await db.assistantClient.create({ data: { id: "apc_unused_old", name: "Claude", redirectUris: redirect, createdAt: new Date(NOW.getTime() - 8 * DAY) } });
    await db.assistantClient.create({ data: { id: "apc_unused_new", name: "Claude", redirectUris: redirect, createdAt: new Date(NOW.getTime() - DAY) } });
    const base = { clientId: "apc_c", redirectUri: redirect[0]!, codeChallenge: "c".repeat(43), browserHash: "h", resource: "https://mcp.test/mcp" };
    await db.assistantAuthRequest.create({ data: { ...base, id: "old", expiresAt: new Date(NOW.getTime() - 25 * 60 * 60 * 1000) } });
    await db.assistantAuthRequest.create({ data: { ...base, id: "new", expiresAt: new Date(NOW.getTime() - 60_000) } });
    const agency = await db.agency.create({ data: { name: "A", country: "IL", bankReference: "APL-CLEAN" } });
    const user = await db.user.create({ data: { email: "clean@example.com", name: "A", role: "AGENT", agencyId: agency.id } });
    const conn = (id: string, extra: object) =>
      db.assistantConnection.create({
        data: { id, agencyId: agency.id, userId: user.id, clientId: "apc_c", clientName: "Claude", scope: "search:read", resource: "https://mcp.test/mcp", accessTokenHash: `a-${id}`, accessExpiresAt: NOW, refreshTokenHash: `r-${id}`, refreshExpiresAt: new Date(NOW.getTime() + DAY), ...extra },
      });
    await conn("live", {});
    await conn("revoked-long-ago", { revokedAt: new Date(NOW.getTime() - 31 * DAY) });
    await conn("revoked-recently", { revokedAt: new Date(NOW.getTime() - DAY) });
    await conn("expired-long-ago", { refreshExpiresAt: new Date(NOW.getTime() - 31 * DAY) });
    expect(await dailyCleanup(NOW)).toMatchObject({ assistant: 4 });
    expect((await db.assistantAuthRequest.findMany()).map((r) => r.id)).toEqual(["new"]);
    expect((await db.assistantConnection.findMany({ orderBy: { id: "asc" } })).map((r) => r.id)).toEqual(["live", "revoked-recently"]);
    expect((await db.assistantClient.findMany({ orderBy: { id: "asc" } })).map((r) => r.id)).toEqual(["apc_c", "apc_unused_new"]);
  });
});
