import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { db } from "@/server/db";
import { createUser } from "@/server/users";
import { resetTestDb } from "@/test/db";
import { audit } from "@/server/audit";
import { credit, getBalance, placeHold } from "@/server/wallet/ledger";
import { IdempotencyKeyConflict, InsufficientFunds, TopupRefConflict } from "@/server/wallet/errors";
import {
  confirmBankTopup,
  getAgencyWallet,
  recordAdjustment,
  recordPayout,
} from "@/server/admin/money";

// The real audit() runs; a test can make one call fail to prove the rollback.
vi.mock("@/server/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/audit")>();
  return { audit: vi.fn(actual.audit) };
});

let adminId: string;
let agencyId: string;

async function makeAgency(name: string, bankReference: string): Promise<string> {
  return (await db.agency.create({ data: { name, country: "IL", bankReference } })).id;
}

function isoDay(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

const topup = (overrides: Partial<Parameters<typeof confirmBankTopup>[1]> = {}) =>
  confirmBankTopup(adminId, {
    agencyId,
    amountCents: 100000,
    bankTransferRef: "TRX-1001",
    receivedOn: "2026-11-01",
    ...overrides,
  });

async function fund(amountCents: number): Promise<void> {
  await credit({
    agencyId,
    type: "TOPUP_BANK",
    amountCents,
    reason: "seed",
    idempotencyKey: `seed-${randomUUID()}`,
  });
}

describe("admin money actions", () => {
  beforeEach(async () => {
    await resetTestDb();
    vi.mocked(audit).mockClear();
    adminId = (await createUser({ email: "admin@example.com", name: "Admin", role: "ADMIN" })).id;
    agencyId = await makeAgency("Sunrise Travel", "APL-0001");
  });

  describe("confirmBankTopup", () => {
    it("same bankTransferRef twice → one entry", async () => {
      const first = await topup();
      const second = await topup();
      expect(first.alreadyRecorded).toBe(false);
      expect(second.alreadyRecorded).toBe(true);
      expect(second.entry.id).toBe(first.entry.id);
      expect(await db.ledgerEntry.count()).toBe(1);
      expect(await db.auditLog.count({ where: { action: "wallet.topup" } })).toBe(1);
      expect(await getBalance(agencyId)).toEqual({ balanceCents: 100000, heldCents: 0 });
    });

    it("writes a TOPUP_BANK credit with the ref-derived key and the R19 reason", async () => {
      const { entry } = await topup();
      expect(entry).toMatchObject({
        agencyId,
        type: "TOPUP_BANK",
        amountCents: 100000,
        currency: "USD",
        idempotencyKey: "topup:TRX-1001",
        reason: "Bank transfer TRX-1001 received 2026-11-01",
        actorUserId: adminId,
      });
    });

    it("normalizes the ref: 'abc 1' and ' ABC  1 ' are the same transfer → one entry", async () => {
      const first = await topup({ bankTransferRef: "abc 1" });
      const second = await topup({ bankTransferRef: " ABC  1 " });
      expect(second.alreadyRecorded).toBe(true);
      expect(second.entry.id).toBe(first.entry.id);
      expect(first.entry.idempotencyKey).toBe("topup:ABC 1");
      expect(first.entry.reason).toBe("Bank transfer ABC 1 received 2026-11-01");
      expect(await db.ledgerEntry.count()).toBe(1);
    });

    it("same ref with a different amount → TopupRefConflict with the original amount, nothing written", async () => {
      await topup();
      const attempt = topup({ amountCents: 50000 });
      await expect(attempt).rejects.toBeInstanceOf(TopupRefConflict);
      await expect(topup({ amountCents: 50000 })).rejects.toThrow(
        /^This bank transfer reference was already recorded for USD 1,000\.00\.$/,
      );
      expect(await db.ledgerEntry.count()).toBe(1);
      expect(await db.auditLog.count()).toBe(1);
      expect(await getBalance(agencyId)).toEqual({ balanceCents: 100000, heldCents: 0 });
    });

    it("same ref already recorded for another agency → TopupRefConflict, other agency's name not leaked", async () => {
      const other = await makeAgency("Secret Other Agency", "APL-0002");
      await topup({ agencyId: other });
      let caught: unknown;
      try {
        await topup();
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(TopupRefConflict);
      expect((caught as Error).message).toBe(
        "This bank transfer reference was already recorded for USD 1,000.00.",
      );
      expect((caught as Error).message).not.toContain("Secret");
      expect(await db.ledgerEntry.count({ where: { agencyId } })).toBe(0);
      expect(await db.auditLog.count()).toBe(1);
    });

    it("two concurrent top-ups with the same ref → one entry, one audit row", async () => {
      const results = await Promise.all([topup(), topup()]);
      expect(results.map((r) => r.alreadyRecorded).sort()).toEqual([false, true]);
      expect(await db.ledgerEntry.count()).toBe(1);
      expect(await db.auditLog.count()).toBe(1);
    });

    it("rejects a bad ref, amount or receivedOn with a validation error and writes nothing", async () => {
      const bad: Partial<Parameters<typeof confirmBankTopup>[1]>[] = [
        { bankTransferRef: "" },
        { bankTransferRef: "    " },
        { bankTransferRef: "x".repeat(101) },
        { amountCents: 0 },
        { amountCents: -100 },
        { amountCents: 1.5 },
        { amountCents: 2147483648 },
        { receivedOn: isoDay(3) }, // in the future
        { receivedOn: "2019-12-31" }, // before 2020-01-01
        { receivedOn: "2024-02-30" }, // not a real date
        { receivedOn: "2024-13-01" },
        { receivedOn: "01/11/2026" },
        { receivedOn: "" },
      ];
      for (const overrides of bad) {
        await expect(topup(overrides), JSON.stringify(overrides)).rejects.toBeInstanceOf(ZodError);
      }
      expect(await db.ledgerEntry.count()).toBe(0);
      expect(await db.auditLog.count()).toBe(0);
    });

    it("rejects the agency's own reference (APL-…) as a bank transfer ref, with a clear message; nothing written", async () => {
      // M2: agents pay with "Reference: APL-0001". Recording that as the bank's transfer
      // reference would make the agency's next same-amount transfer look "already recorded".
      for (const bankTransferRef of ["APL-0001", " apl-0001 ", "APL-12"]) {
        const error = await topup({ bankTransferRef }).catch((e: unknown) => e);
        expect(error, bankTransferRef).toBeInstanceOf(ZodError);
        expect((error as ZodError).issues.map((i) => i.message)).toEqual([
          "Enter the bank's own transfer reference, not the agency reference (APL-…).",
        ]);
      }
      expect(await db.ledgerEntry.count()).toBe(0);
      expect(await db.auditLog.count()).toBe(0);
      // A real bank reference, even one that mentions APL, still works.
      await expect(topup({ bankTransferRef: "TRX-APL-0001" })).resolves.toMatchObject({ alreadyRecorded: false });
      await expect(topup({ bankTransferRef: "FT2611080001" })).resolves.toMatchObject({ alreadyRecorded: false });
      expect(await db.ledgerEntry.count()).toBe(2);
    });

    it("accepts receivedOn of today, 2020-01-01, and a ref of exactly 100 characters", async () => {
      await expect(topup({ receivedOn: isoDay(0), bankTransferRef: "R-1" })).resolves.toBeTruthy();
      await expect(topup({ receivedOn: "2020-01-01", bankTransferRef: "R-2" })).resolves.toBeTruthy();
      await expect(topup({ bankTransferRef: "y".repeat(100) })).resolves.toBeTruthy();
      expect(await db.ledgerEntry.count()).toBe(3);
    });

    it("rejects unknown fields", async () => {
      await expect(
        confirmBankTopup(adminId, {
          agencyId,
          amountCents: 100,
          bankTransferRef: "R",
          receivedOn: "2026-01-01",
          extra: 1,
        } as unknown as Parameters<typeof confirmBankTopup>[1]),
      ).rejects.toBeInstanceOf(ZodError);
    });
  });

  describe("recordPayout", () => {
    it("payout above available → InsufficientFunds", async () => {
      await fund(10000);
      await placeHold({ agencyId, amountCents: 4000, bookingRef: "B-1", idempotencyKey: "h-1" });
      await expect(
        recordPayout(adminId, {
          agencyId,
          amountCents: 6001,
          note: "Refund to agency bank account",
          idempotencyKey: randomUUID(),
        }),
      ).rejects.toBeInstanceOf(InsufficientFunds);
      expect(await db.ledgerEntry.count({ where: { type: "PAYOUT" } })).toBe(0);
      expect(await db.auditLog.count()).toBe(0);
    });

    it("payout of exactly the available amount writes a negative PAYOUT with the note as reason", async () => {
      await fund(10000);
      const key = randomUUID();
      const { entry, alreadyRecorded } = await recordPayout(adminId, {
        agencyId,
        amountCents: 10000,
        note: "  Returned to agency  ",
        idempotencyKey: key,
      });
      expect(alreadyRecorded).toBe(false);
      expect(entry).toMatchObject({
        type: "PAYOUT",
        amountCents: -10000,
        reason: "Returned to agency",
        idempotencyKey: `payout:${key}`,
        actorUserId: adminId,
      });
      expect(await getBalance(agencyId)).toEqual({ balanceCents: 0, heldCents: 0 });
    });

    it("payout repeat with the same key → one entry and one audit row", async () => {
      await fund(10000);
      const input = { agencyId, amountCents: 2500, note: "Payout", idempotencyKey: randomUUID() };
      const first = await recordPayout(adminId, input);
      const second = await recordPayout(adminId, input);
      expect(second.alreadyRecorded).toBe(true);
      expect(second.entry.id).toBe(first.entry.id);
      expect(await db.ledgerEntry.count({ where: { type: "PAYOUT" } })).toBe(1);
      expect(await db.auditLog.count({ where: { action: "wallet.payout" } })).toBe(1);
    });

    it("the same key with a different amount is a conflict, not a silent repeat", async () => {
      await fund(10000);
      const key = randomUUID();
      await recordPayout(adminId, { agencyId, amountCents: 2500, note: "Payout", idempotencyKey: key });
      await expect(
        recordPayout(adminId, { agencyId, amountCents: 3000, note: "Payout", idempotencyKey: key }),
      ).rejects.toBeInstanceOf(IdempotencyKeyConflict);
      expect(await db.ledgerEntry.count({ where: { type: "PAYOUT" } })).toBe(1);
    });

    it("note is required (1–500 chars) and the key must be a UUID", async () => {
      await fund(10000);
      for (const overrides of [
        { note: "" },
        { note: "   " },
        { note: "x".repeat(501) },
        { idempotencyKey: "not-a-uuid" },
        { idempotencyKey: "" },
        { amountCents: 0 },
      ]) {
        await expect(
          recordPayout(adminId, {
            agencyId,
            amountCents: 100,
            note: "ok",
            idempotencyKey: randomUUID(),
            ...overrides,
          }),
          JSON.stringify(overrides),
        ).rejects.toBeInstanceOf(ZodError);
      }
      expect(await db.ledgerEntry.count({ where: { type: "PAYOUT" } })).toBe(0);
    });
  });

  describe("recordAdjustment", () => {
    const adjust = (overrides: Partial<Parameters<typeof recordAdjustment>[1]> = {}) =>
      recordAdjustment(adminId, {
        agencyId,
        amountCents: 1250,
        reason: "Correction of bank fee",
        idempotencyKey: randomUUID(),
        ...overrides,
      });

    it("adjustment without reason → validation error", async () => {
      for (const reason of ["", "    ", "abcd", "  abcd  ", "x".repeat(501)]) {
        await expect(adjust({ reason }), JSON.stringify(reason)).rejects.toBeInstanceOf(ZodError);
      }
      expect(await db.ledgerEntry.count()).toBe(0);
      expect(await db.auditLog.count()).toBe(0);
    });

    it("adjustment amount 0 → validation error", async () => {
      await expect(adjust({ amountCents: 0 })).rejects.toBeInstanceOf(ZodError);
      await expect(adjust({ amountCents: 2147483648 })).rejects.toBeInstanceOf(ZodError);
      await expect(adjust({ amountCents: -2147483648 })).rejects.toBeInstanceOf(ZodError);
      expect(await db.ledgerEntry.count()).toBe(0);
    });

    it("positive → ADJUSTMENT credit; negative → ADJUSTMENT debit of |amount|", async () => {
      const plus = await adjust({ amountCents: 1250, reason: "  Goodwill credit " });
      expect(plus.entry).toMatchObject({ type: "ADJUSTMENT", amountCents: 1250, reason: "Goodwill credit" });
      const minus = await adjust({ amountCents: -250 });
      expect(minus.entry).toMatchObject({ type: "ADJUSTMENT", amountCents: -250 });
      expect(plus.entry.idempotencyKey).toMatch(/^adjust:[0-9a-f-]{36}$/);
      expect(await getBalance(agencyId)).toEqual({ balanceCents: 1000, heldCents: 0 });
    });

    it("negative adjustment beyond available → InsufficientFunds, nothing written", async () => {
      await fund(1000);
      await expect(adjust({ amountCents: -1001 })).rejects.toBeInstanceOf(InsufficientFunds);
      expect(await db.ledgerEntry.count({ where: { type: "ADJUSTMENT" } })).toBe(0);
      expect(await db.auditLog.count()).toBe(0);
    });

    it("repeat with the same key → one entry and one audit row", async () => {
      await fund(1000);
      const key = randomUUID();
      await adjust({ amountCents: -300, idempotencyKey: key });
      const again = await adjust({ amountCents: -300, idempotencyKey: key });
      expect(again.alreadyRecorded).toBe(true);
      expect(await db.ledgerEntry.count({ where: { type: "ADJUSTMENT" } })).toBe(1);
      expect(await db.auditLog.count({ where: { action: "wallet.adjustment" } })).toBe(1);
      // Same key with the opposite sign is not a repeat.
      await expect(adjust({ amountCents: 300, idempotencyKey: key })).rejects.toBeInstanceOf(
        IdempotencyKeyConflict,
      );
    });
  });

  describe("audit", () => {
    it("each action writes an audit row", async () => {
      const t = await topup();
      const payoutKey = randomUUID();
      const p = await recordPayout(adminId, {
        agencyId,
        amountCents: 2000,
        note: "Payout to agency",
        idempotencyKey: payoutKey,
      });
      const a = await recordAdjustment(adminId, {
        agencyId,
        amountCents: -500,
        reason: "Bank fee correction",
        idempotencyKey: randomUUID(),
      });

      const rows = await db.auditLog.findMany({ orderBy: { createdAt: "asc" } });
      expect(rows).toHaveLength(3);
      const byAction = new Map(rows.map((r) => [r.action, r]));
      for (const row of rows) {
        expect(row).toMatchObject({ actorUserId: adminId, targetType: "Agency", targetId: agencyId, before: null });
      }
      expect(byAction.get("wallet.topup")?.after).toEqual({
        entryId: t.entry.id,
        type: "TOPUP_BANK",
        amountCents: 100000,
        currency: "USD",
        bankTransferRef: "TRX-1001",
        receivedOn: "2026-11-01",
        reason: "Bank transfer TRX-1001 received 2026-11-01",
      });
      expect(byAction.get("wallet.payout")?.after).toEqual({
        entryId: p.entry.id,
        type: "PAYOUT",
        amountCents: -2000,
        currency: "USD",
        reason: "Payout to agency",
      });
      expect(byAction.get("wallet.adjustment")?.after).toEqual({
        entryId: a.entry.id,
        type: "ADJUSTMENT",
        amountCents: -500,
        currency: "USD",
        reason: "Bank fee correction",
      });
    });

    it("the audit row is in the same transaction: if it fails, the ledger entry is rolled back", async () => {
      vi.mocked(audit).mockRejectedValueOnce(new Error("audit down"));
      await expect(topup()).rejects.toThrow("audit down");
      expect(await db.ledgerEntry.count()).toBe(0);
      expect(await db.auditLog.count()).toBe(0);

      // The key was not used up: the retry writes the entry and its audit row.
      const retry = await topup();
      expect(retry.alreadyRecorded).toBe(false);
      expect(await db.ledgerEntry.count()).toBe(1);
      expect(await db.auditLog.count()).toBe(1);

      vi.mocked(audit).mockRejectedValueOnce(new Error("audit down"));
      await expect(
        recordPayout(adminId, { agencyId, amountCents: 100, note: "x", idempotencyKey: randomUUID() }),
      ).rejects.toThrow("audit down");
      vi.mocked(audit).mockRejectedValueOnce(new Error("audit down"));
      await expect(
        recordAdjustment(adminId, {
          agencyId,
          amountCents: -100,
          reason: "Correction",
          idempotencyKey: randomUUID(),
        }),
      ).rejects.toThrow("audit down");
      expect(await db.ledgerEntry.count()).toBe(1);
      expect(await getBalance(agencyId)).toEqual({ balanceCents: 100000, heldCents: 0 });
    });
  });

  describe("getAgencyWallet", () => {
    it("returns the agency, its balance and the newest entries; null for an unknown agency", async () => {
      await fund(5000);
      await placeHold({ agencyId, amountCents: 1000, bookingRef: "B-1", idempotencyKey: "h-1" });
      const wallet = await getAgencyWallet(agencyId);
      expect(wallet?.agency).toEqual({ id: agencyId, name: "Sunrise Travel", bankReference: "APL-0001" });
      expect(wallet?.balance).toEqual({ balanceCents: 4000, heldCents: 1000 });
      expect(wallet?.entries.map((e) => e.type)).toEqual(["HOLD", "TOPUP_BANK"]);
      expect(wallet?.nextCursor).toBeNull();
      expect(await getAgencyWallet("no-such-agency")).toBeNull();
    });
  });
});
