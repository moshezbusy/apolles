import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { resetTestDb } from "@/test/db";
import { seedDemoContent } from "./demo-seed";

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
