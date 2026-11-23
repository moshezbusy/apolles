import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { resetTestDb } from "@/test/db";
import { audit, auditActions, listAuditLog, redactAuditValue } from "./audit";

describe("audit log (admin action log)", () => {
  beforeEach(async () => {
    await resetTestDb();
    await db.user.create({ data: { id: "admin", email: "admin@t.local", name: "Admin", role: "ADMIN" } });
    await db.user.create({ data: { id: "agent", email: "agent@t.local", name: "Agent", role: "AGENT" } });
  });

  it("newest first, filtered by action and by the email of who did it", async () => {
    await audit("admin", "agency.suspend", "Agency", "a1", { status: "ACTIVE" }, { status: "SUSPENDED" });
    await audit("agent", "user.sign-in", "User", "agent", undefined, { secondStep: "email-code" });
    await audit("admin", "booking.refund", "Booking", "b1", { refundMinor: null }, { refundMinor: 100 });
    expect((await listAuditLog({})).rows.map((r) => r.action)).toEqual(["booking.refund", "user.sign-in", "agency.suspend"]);
    expect((await listAuditLog({ action: "user.sign-in" })).rows.map((r) => r.actor.email)).toEqual(["agent@t.local"]);
    expect((await listAuditLog({ actorEmail: " ADMIN@t.local " })).rows.map((r) => r.action)).toEqual(["booking.refund", "agency.suspend"]);
    expect((await listAuditLog({ actorEmail: "nobody@t.local" })).rows).toEqual([]);
    expect(await auditActions()).toEqual(["agency.suspend", "booking.refund", "user.sign-in"]);
  });

  it("pages with a cursor", async () => {
    for (let i = 0; i < 55; i++) await audit("admin", "x.test", "User", `t${i}`);
    const first = await listAuditLog({});
    expect(first.rows).toHaveLength(50);
    const second = await listAuditLog({ cursor: first.nextCursor! });
    expect(second.rows).toHaveLength(5);
    expect(new Set([...first.rows, ...second.rows].map((r) => r.id)).size).toBe(55);
    expect(second.nextCursor).toBeNull();
  });

  it("anything that looks secret is hidden, at any depth", async () => {
    const key = "k".repeat(32);
    await audit("admin", "x.test", "User", "t", { passwordHash: key, nested: { apiToken: key, ok: 1 } }, { list: [{ totpSecret: key }] });
    const [row] = (await listAuditLog({})).rows;
    expect(JSON.stringify(row)).not.toContain(key);
    expect(row!.before).toEqual({ passwordHash: "[hidden]", nested: { apiToken: "[hidden]", ok: 1 } });
    expect(redactAuditValue(null)).toBeNull();
  });
});
