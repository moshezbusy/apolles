import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { forAgency } from "@/server/scope";
import { credit } from "@/server/wallet/ledger";
import { resetTestDb } from "@/test/db";

async function createAgency(bankReference: string): Promise<string> {
  const agency = await db.agency.create({
    data: { name: `Agency ${bankReference}`, country: "IL", bankReference },
  });
  return agency.id;
}

describe("forAgency", () => {
  let agencyA: string;
  let agencyB: string;
  let entryA: { id: string };
  let entryB: { id: string };

  beforeEach(async () => {
    await resetTestDb();
    agencyA = await createAgency("APL-SCOPE-A");
    agencyB = await createAgency("APL-SCOPE-B");
    entryA = await credit({
      agencyId: agencyA,
      type: "TOPUP_BANK",
      amountCents: 1000,
      reason: "A topup",
      idempotencyKey: "scope-a-1",
    });
    entryB = await credit({
      agencyId: agencyB,
      type: "TOPUP_BANK",
      amountCents: 2000,
      reason: "B topup",
      idempotencyKey: "scope-b-1",
    });
  });

  it("agency A requesting agency B ledger entry id -> null", async () => {
    expect(await forAgency(agencyA).ledger.get(entryB.id)).toBeNull();
  });

  it("agency A requesting its own ledger entry id -> the entry", async () => {
    const found = await forAgency(agencyA).ledger.get(entryA.id);
    expect(found?.id).toBe(entryA.id);
    expect(found?.agencyId).toBe(agencyA);
  });

  it("ledger.list returns only the caller's entries", async () => {
    const { entries } = await forAgency(agencyA).ledger.list();
    expect(entries.map((e) => e.id)).toEqual([entryA.id]);
  });

  it("ledger.list rejects a cursor that belongs to another agency", async () => {
    await expect(forAgency(agencyA).ledger.list(entryB.id)).rejects.toThrow("Invalid cursor");
  });

  it("throws when agencyId is empty", () => {
    expect(() => forAgency("")).toThrow();
  });
});
