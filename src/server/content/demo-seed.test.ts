import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { resetTestDb } from "@/test/db";
import { getBalance } from "@/server/wallet/ledger";
import { isValidPassword, verifyPassword } from "@/server/auth/password";
import { resetDemoAgentPassword, seedDemoAgent, seedDemoContent } from "./demo-seed";

describe("seedDemoContent (staging demo data)", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("creates demo destinations with hotels, and running it twice changes nothing", async () => {
    await seedDemoContent();
    const destinations = await db.destination.count({ where: { id: { startsWith: "demo-" } } });
    const hotels = await db.property.count({ where: { id: { startsWith: "demo-" }, active: true, expediaCollect: true } });
    expect(destinations).toBeGreaterThanOrEqual(5);
    expect(hotels).toBeGreaterThanOrEqual(30);
    await seedDemoContent();
    expect(await db.destination.count({ where: { id: { startsWith: "demo-" } } })).toBe(destinations);
    expect(await db.property.count({ where: { id: { startsWith: "demo-" } } })).toBe(hotels);
    expect(await db.destinationProperty.count()).toBe(hotels);
  });

  it("never touches real (non-demo) data", async () => {
    await db.property.create({ data: { id: "123", name: "Real", city: "Paris", countryCode: "FR", expediaCollect: true, active: true, catalogSeenRunId: "r" } });
    await seedDemoContent();
    expect(await db.property.findUniqueOrThrow({ where: { id: "123" } })).toMatchObject({ name: "Real", active: true });
  });
});

describe("seedDemoAgent (staging demo login)", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("creates a demo agency with USD 10,000 of demo balance and an agent, once; gives a set-password link only while no password is set", async () => {
    const first = await seedDemoAgent("https://staging.example");
    expect(first.email).toBe("demo-agent@apolles.test");
    expect(first.setPasswordLink).toMatch(/^https:\/\/staging\.example\/set-password\/[A-Za-z0-9_-]+$/);
    const again = await seedDemoAgent("https://staging.example");
    expect(again.setPasswordLink).toMatch(/set-password/); // still no password: a fresh link
    expect(await db.agency.count({ where: { id: "demo-agency" } })).toBe(1);
    expect(await getBalance("demo-agency")).toEqual({ balanceCents: 1_000_000, heldCents: 0 });
    await db.user.update({ where: { email: "demo-agent@apolles.test" }, data: { passwordHash: "set" } });
    expect((await seedDemoAgent("https://staging.example")).setPasswordLink).toBeNull();
  });
});

describe("resetDemoAgentPassword (admin button, staging demo)", () => {
  beforeEach(async () => {
    await resetTestDb();
    await db.user.create({ data: { id: "admin-1", email: "owner@test.local", name: "Owner", role: "ADMIN" } });
  });

  it("gives a fresh readable password that signs in, ends old sessions and is audited", async () => {
    const { email, password } = await resetDemoAgentPassword("admin-1", "https://staging.example");
    expect(email).toBe("demo-agent@apolles.test");
    expect(password).toMatch(/^[A-HJ-NP-Za-km-z2-9]{4}-[A-HJ-NP-Za-km-z2-9]{4}-[A-HJ-NP-Za-km-z2-9]{4}$/);
    expect(isValidPassword(password)).toBe(true);
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(await verifyPassword(user.passwordHash!, password)).toBe(true);
    const second = await resetDemoAgentPassword("admin-1", "https://staging.example");
    expect(second.password).not.toBe(password);
    const audit = await db.auditLog.findMany({ where: { action: "demo.agent_password_reset" } });
    expect(audit).toHaveLength(2);
    expect(JSON.stringify(audit)).not.toContain(password);
  });
});
