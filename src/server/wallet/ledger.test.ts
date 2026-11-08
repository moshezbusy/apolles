import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { createUser } from "@/server/users";
import { resetTestDb } from "@/test/db";
import {
  AgencyNotFound,
  HoldNotOpen,
  IdempotencyKeyConflict,
  InsufficientFunds,
  InvalidAmount,
} from "@/server/wallet/errors";
import {
  captureHold,
  credit,
  creditInTx,
  debit,
  debitInTx,
  getBalance,
  listEntries,
  listEntriesWithBalance,
  placeHold,
  releaseHold,
  withLedgerTransaction,
} from "@/server/wallet/ledger";

async function createAgency(bankReference: string): Promise<string> {
  const agency = await db.agency.create({
    data: { name: `Agency ${bankReference}`, country: "IL", bankReference },
  });
  return agency.id;
}

let agencyId: string;

async function fund(amountCents = 100000, idempotencyKey = "topup-1") {
  return credit({
    agencyId,
    type: "TOPUP_BANK",
    amountCents,
    reason: "Bank transfer",
    idempotencyKey,
  });
}

// Opens several pool connections up front. Without this, the second of two "concurrent" calls
// waits to open a new connection and the first one has already committed, so the race the
// test is meant to provoke never happens.
async function warmPool(connections = 4): Promise<void> {
  await Promise.all(
    Array.from({ length: connections }, () =>
      db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_sleep(0.05)`;
      }),
    ),
  );
}

async function entryCount(id = agencyId): Promise<number> {
  return db.ledgerEntry.count({ where: { agencyId: id } });
}

describe("wallet ledger", () => {
  beforeEach(async () => {
    await resetTestDb();
    agencyId = await createAgency("APL-0001");
  });

  describe("balances", () => {
    it("credit 100000 then getBalance → { balanceCents: 100000, heldCents: 0 }", async () => {
      const entry = await fund();
      expect(entry.amountCents).toBe(100000);
      expect(entry.type).toBe("TOPUP_BANK");
      expect(entry.currency).toBe("USD");
      expect(await getBalance(agencyId)).toEqual({ balanceCents: 100000, heldCents: 0 });
    });

    it("placeHold 30000 → balance 70000, held 30000", async () => {
      await fund();
      const { holdId } = await placeHold({
        agencyId,
        amountCents: 30000,
        bookingRef: "BK-1",
        idempotencyKey: "hold-1",
      });
      expect(holdId).toEqual(expect.any(String));
      expect(await getBalance(agencyId)).toEqual({ balanceCents: 70000, heldCents: 30000 });
    });

    it("captureHold → balance 70000, held 0; entries are HOLD -30000, HOLD_RELEASE +30000, CHARGE -30000", async () => {
      await fund();
      const { holdId } = await placeHold({
        agencyId,
        amountCents: 30000,
        bookingRef: "BK-1",
        idempotencyKey: "hold-1",
      });
      await captureHold(holdId, "capture-1");

      expect(await getBalance(agencyId)).toEqual({ balanceCents: 70000, heldCents: 0 });
      const holdEntries = await db.ledgerEntry.findMany({ where: { holdId } });
      expect(holdEntries.map((e) => `${e.type} ${e.amountCents}`).sort()).toEqual(
        ["CHARGE -30000", "HOLD -30000", "HOLD_RELEASE 30000"].sort(),
      );
      for (const e of holdEntries) {
        expect(e.bookingRef).toBe("BK-1");
        expect(e.agencyId).toBe(agencyId);
        expect(e.currency).toBe("USD");
      }
    });

    it("releaseHold → balance 100000, held 0", async () => {
      await fund();
      const { holdId } = await placeHold({
        agencyId,
        amountCents: 30000,
        bookingRef: "BK-1",
        idempotencyKey: "hold-1",
      });
      await releaseHold(holdId, "release-1");
      expect(await getBalance(agencyId)).toEqual({ balanceCents: 100000, heldCents: 0 });
      const release = await db.ledgerEntry.findUniqueOrThrow({
        where: { idempotencyKey: "release-1" },
      });
      expect(release).toMatchObject({ type: "HOLD_RELEASE", amountCents: 30000, holdId });
    });

    it("balances are per agency", async () => {
      await fund();
      const otherId = await createAgency("APL-0002");
      expect(await getBalance(otherId)).toEqual({ balanceCents: 0, heldCents: 0 });
    });
  });

  describe("insufficient funds", () => {
    it("placeHold over available throws InsufficientFunds and writes nothing", async () => {
      await fund();
      await expect(
        placeHold({ agencyId, amountCents: 100001, bookingRef: "BK-1", idempotencyKey: "hold-1" }),
      ).rejects.toBeInstanceOf(InsufficientFunds);
      expect(await entryCount()).toBe(1);
      expect(await getBalance(agencyId)).toEqual({ balanceCents: 100000, heldCents: 0 });
    });

    it("two concurrent placeHold of 60000 on a 100000 balance (Promise.allSettled) → exactly one fulfilled, one InsufficientFunds", async () => {
      await fund();
      await warmPool();
      const results = await Promise.allSettled([
        placeHold({ agencyId, amountCents: 60000, bookingRef: "BK-A", idempotencyKey: "hold-a" }),
        placeHold({ agencyId, amountCents: 60000, bookingRef: "BK-B", idempotencyKey: "hold-b" }),
      ]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(InsufficientFunds);
      expect(await getBalance(agencyId)).toEqual({ balanceCents: 40000, heldCents: 60000 });
      expect(await db.ledgerEntry.count({ where: { agencyId, type: "HOLD" } })).toBe(1);
    });

    it("placeHold waits for the agency lock and then sees what the lock holder wrote (no overdraft)", async () => {
      await fund();
      await warmPool();
      let releaseBlocker!: () => void;
      const blockerCanFinish = new Promise<void>((resolve) => {
        releaseBlocker = resolve;
      });
      let markLocked!: () => void;
      const blockerHasLock = new Promise<void>((resolve) => {
        markLocked = resolve;
      });
      // Another writer holds the agency lock and spends 95000 before committing.
      const blocker = db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "Agency" WHERE id = ${agencyId} FOR UPDATE`;
          await tx.ledgerEntry.create({
            data: {
              agencyId,
              type: "PAYOUT",
              amountCents: -95000,
              reason: "Payout",
              idempotencyKey: "payout-blocker",
            },
          });
          markLocked();
          await blockerCanFinish;
        },
        { timeout: 10_000 },
      );
      await blockerHasLock;

      // Committed balance is still 100000 here; a hold that read it now would overdraw.
      const hold = placeHold({
        agencyId,
        amountCents: 10000,
        bookingRef: "BK-1",
        idempotencyKey: "h-1",
      });
      const holdSettled = hold.then(
        () => "fulfilled",
        () => "rejected",
      );
      const early = await Promise.race([
        holdSettled,
        new Promise((resolve) => setTimeout(() => resolve("waiting"), 300)),
      ]);
      expect(early).toBe("waiting");

      releaseBlocker();
      await blocker;
      await expect(hold).rejects.toBeInstanceOf(InsufficientFunds);
      expect(await getBalance(agencyId)).toEqual({ balanceCents: 5000, heldCents: 0 });
    });

    it("debit above available throws InsufficientFunds and writes nothing", async () => {
      const admin = await createUser({ email: "admin@test.local", name: "Admin", role: "ADMIN" });
      await fund();
      await placeHold({ agencyId, amountCents: 70000, bookingRef: "BK-1", idempotencyKey: "h-1" });
      await expect(
        debit({
          agencyId,
          type: "PAYOUT",
          amountCents: 40000,
          reason: "Payout",
          actorUserId: admin.id,
          idempotencyKey: "payout-1",
        }),
      ).rejects.toBeInstanceOf(InsufficientFunds);
      expect(await entryCount()).toBe(2);
      expect(await getBalance(agencyId)).toEqual({ balanceCents: 30000, heldCents: 70000 });
    });

    it("debit within available writes a negative entry", async () => {
      const admin = await createUser({ email: "admin@test.local", name: "Admin", role: "ADMIN" });
      await fund();
      const entry = await debit({
        agencyId,
        type: "ADJUSTMENT",
        amountCents: 25000,
        reason: "Correction",
        actorUserId: admin.id,
        idempotencyKey: "adj-1",
      });
      expect(entry).toMatchObject({
        type: "ADJUSTMENT",
        amountCents: -25000,
        actorUserId: admin.id,
        currency: "USD",
      });
      expect(await getBalance(agencyId)).toEqual({ balanceCents: 75000, heldCents: 0 });
    });
  });

  describe("idempotency", () => {
    it("credit twice with the same idempotencyKey → one entry", async () => {
      const first = await fund(100000, "topup-same");
      const second = await fund(100000, "topup-same");
      expect(second.id).toBe(first.id);
      expect(await entryCount()).toBe(1);
      expect(await getBalance(agencyId)).toEqual({ balanceCents: 100000, heldCents: 0 });
    });

    it("two concurrent credit calls with the same idempotencyKey → exactly one entry", async () => {
      await warmPool();
      const results = await Promise.allSettled([
        fund(100000, "topup-race"),
        fund(100000, "topup-race"),
      ]);
      expect(results.every((r) => r.status === "fulfilled")).toBe(true);
      const ids = results.map((r) => (r as PromiseFulfilledResult<{ id: string }>).value.id);
      expect(ids[0]).toBe(ids[1]);
      expect(await entryCount()).toBe(1);
      expect(await getBalance(agencyId)).toEqual({ balanceCents: 100000, heldCents: 0 });
    });

    it("placeHold twice with the same key → one HOLD, same holdId", async () => {
      await fund();
      const input = { agencyId, amountCents: 30000, bookingRef: "BK-1", idempotencyKey: "h-1" };
      const first = await placeHold(input);
      const second = await placeHold(input);
      expect(second.holdId).toBe(first.holdId);
      expect(await db.ledgerEntry.count({ where: { type: "HOLD" } })).toBe(1);
      expect(await getBalance(agencyId)).toEqual({ balanceCents: 70000, heldCents: 30000 });
    });

    it("releaseHold twice with the same key → no second entry", async () => {
      await fund();
      const { holdId } = await placeHold({
        agencyId,
        amountCents: 30000,
        bookingRef: "BK-1",
        idempotencyKey: "h-1",
      });
      await releaseHold(holdId, "release-1");
      await releaseHold(holdId, "release-1");
      expect(await db.ledgerEntry.count({ where: { holdId, type: "HOLD_RELEASE" } })).toBe(1);
      expect(await entryCount()).toBe(3);
      expect(await getBalance(agencyId)).toEqual({ balanceCents: 100000, heldCents: 0 });
    });

    it("captureHold twice with the same key → one HOLD_RELEASE and one CHARGE", async () => {
      await fund();
      const { holdId } = await placeHold({
        agencyId,
        amountCents: 30000,
        bookingRef: "BK-1",
        idempotencyKey: "h-1",
      });
      await captureHold(holdId, "capture-1");
      await captureHold(holdId, "capture-1");
      expect(await db.ledgerEntry.count({ where: { holdId } })).toBe(3);
      expect(await getBalance(agencyId)).toEqual({ balanceCents: 70000, heldCents: 0 });
    });

    it("a key used by another agency is a conflict and leaks nothing", async () => {
      await fund(100000, "shared-key");
      const otherId = await createAgency("APL-0002");
      await expect(
        credit({
          agencyId: otherId,
          type: "TOPUP_BANK",
          amountCents: 5000,
          reason: "Bank transfer",
          idempotencyKey: "shared-key",
        }),
      ).rejects.toBeInstanceOf(IdempotencyKeyConflict);
      expect(await entryCount(otherId)).toBe(0);
    });

    it("the same key for two agencies at the same moment → one entry, one IdempotencyKeyConflict (unique-index race)", async () => {
      const otherId = await createAgency("APL-0002");
      await warmPool();
      const results = await Promise.allSettled([
        credit({
          agencyId,
          type: "TOPUP_BANK",
          amountCents: 100,
          reason: "x",
          idempotencyKey: "race-key",
        }),
        credit({
          agencyId: otherId,
          type: "TOPUP_BANK",
          amountCents: 200,
          reason: "x",
          idempotencyKey: "race-key",
        }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = results.filter((r) => r.status === "rejected");
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(IdempotencyKeyConflict);
      expect(await db.ledgerEntry.count()).toBe(1);
    });

    it("a key used by a different operation is a conflict", async () => {
      await fund(100000, "key-1");
      await expect(
        placeHold({ agencyId, amountCents: 1000, bookingRef: "BK-1", idempotencyKey: "key-1" }),
      ).rejects.toBeInstanceOf(IdempotencyKeyConflict);
      expect(await entryCount()).toBe(1);
    });

    it("releaseHold with the key of an earlier capture of that hold → HoldNotOpen, nothing written", async () => {
      await fund();
      const { holdId } = await placeHold({
        agencyId,
        amountCents: 30000,
        bookingRef: "BK-1",
        idempotencyKey: "h-1",
      });
      await captureHold(holdId, "op-1");
      await expect(releaseHold(holdId, "op-1")).rejects.toBeInstanceOf(HoldNotOpen);
      expect(await entryCount()).toBe(4);
    });

    it("captureHold whose charge key is already taken writes nothing", async () => {
      await fund(100000, "cap-1:charge");
      const { holdId } = await placeHold({
        agencyId,
        amountCents: 30000,
        bookingRef: "BK-1",
        idempotencyKey: "h-1",
      });
      await expect(captureHold(holdId, "cap-1")).rejects.toBeInstanceOf(IdempotencyKeyConflict);
      expect(await entryCount()).toBe(2);
      expect(await getBalance(agencyId)).toEqual({ balanceCents: 70000, heldCents: 30000 });
    });
  });

  describe("hold state", () => {
    it("captureHold on a released hold throws HoldNotOpen", async () => {
      await fund();
      const { holdId } = await placeHold({
        agencyId,
        amountCents: 30000,
        bookingRef: "BK-1",
        idempotencyKey: "h-1",
      });
      await releaseHold(holdId, "release-1");
      await expect(captureHold(holdId, "capture-1")).rejects.toBeInstanceOf(HoldNotOpen);
      expect(await entryCount()).toBe(3);
    });

    it("releaseHold on a captured hold (new key) throws HoldNotOpen", async () => {
      await fund();
      const { holdId } = await placeHold({
        agencyId,
        amountCents: 30000,
        bookingRef: "BK-1",
        idempotencyKey: "h-1",
      });
      await captureHold(holdId, "capture-1");
      await expect(releaseHold(holdId, "release-1")).rejects.toBeInstanceOf(HoldNotOpen);
      expect(await entryCount()).toBe(4);
    });

    it("unknown holdId throws HoldNotOpen", async () => {
      await expect(releaseHold("no-such-hold", "r-1")).rejects.toBeInstanceOf(HoldNotOpen);
      await expect(captureHold("no-such-hold", "c-1")).rejects.toBeInstanceOf(HoldNotOpen);
    });
  });

  describe("amount validation", () => {
    it.each([0, -100, 10.5, Number.NaN, Number.POSITIVE_INFINITY, 2147483648])(
      "amountCents %s → InvalidAmount",
      async (amountCents) => {
        await fund();
        await expect(
          credit({ agencyId, type: "REFUND", amountCents, reason: "x", idempotencyKey: "c-x" }),
        ).rejects.toBeInstanceOf(InvalidAmount);
        await expect(
          debit({
            agencyId,
            type: "PAYOUT",
            amountCents,
            reason: "x",
            actorUserId: "nobody",
            idempotencyKey: "d-x",
          }),
        ).rejects.toBeInstanceOf(InvalidAmount);
        await expect(
          placeHold({ agencyId, amountCents, bookingRef: "BK-1", idempotencyKey: "h-x" }),
        ).rejects.toBeInstanceOf(InvalidAmount);
        expect(await entryCount()).toBe(1);
      },
    );

    it("accepts the maximum amount 2147483647", async () => {
      const entry = await fund(2147483647, "max");
      expect(entry.amountCents).toBe(2147483647);
    });
  });

  describe("inside a caller's transaction", () => {
    let actorId: string;
    beforeEach(async () => {
      actorId = (await createUser({ email: "admin@test.local", name: "Admin", role: "ADMIN" })).id;
    });

    it("creditInTx / debitInTx report created: true, then false for a repeat", async () => {
      const first = await withLedgerTransaction((tx) =>
        creditInTx(tx, { agencyId, type: "TOPUP_BANK", amountCents: 500, reason: "x", idempotencyKey: "tx-c" }),
      );
      const again = await withLedgerTransaction((tx) =>
        creditInTx(tx, { agencyId, type: "TOPUP_BANK", amountCents: 500, reason: "x", idempotencyKey: "tx-c" }),
      );
      expect(first.created).toBe(true);
      expect(again).toEqual({ entry: first.entry, created: false });

      const d1 = await withLedgerTransaction((tx) =>
        debitInTx(tx, { agencyId, type: "PAYOUT", amountCents: 200, reason: "x", actorUserId: actorId, idempotencyKey: "tx-d" }),
      );
      const d2 = await withLedgerTransaction((tx) =>
        debitInTx(tx, { agencyId, type: "PAYOUT", amountCents: 200, reason: "x", actorUserId: actorId, idempotencyKey: "tx-d" }),
      );
      expect([d1.created, d2.created]).toEqual([true, false]);
      expect(d1.entry.amountCents).toBe(-200);
      expect(await entryCount()).toBe(2);
    });

    it("credit / debit with a tx are rolled back with the caller's transaction", async () => {
      await fund(1000);
      await expect(
        withLedgerTransaction(async (tx) => {
          await credit({ agencyId, type: "REFUND", amountCents: 50, reason: "x", idempotencyKey: "tx-r" }, tx);
          await debit(
            { agencyId, type: "PAYOUT", amountCents: 70, reason: "x", actorUserId: actorId, idempotencyKey: "tx-p" },
            tx,
          );
          throw new Error("caller failed");
        }),
      ).rejects.toThrow("caller failed");
      expect(await entryCount()).toBe(1);
      expect(await getBalance(agencyId)).toEqual({ balanceCents: 1000, heldCents: 0 });
    });

    it("debitInTx still checks the balance and the agency", async () => {
      await expect(
        withLedgerTransaction((tx) =>
          debitInTx(tx, { agencyId, type: "PAYOUT", amountCents: 1, reason: "x", actorUserId: actorId, idempotencyKey: "tx-x" }),
        ),
      ).rejects.toBeInstanceOf(InsufficientFunds);
      await expect(
        withLedgerTransaction((tx) =>
          creditInTx(tx, { agencyId: "nope", type: "REFUND", amountCents: 1, reason: "x", idempotencyKey: "tx-y" }),
        ),
      ).rejects.toBeInstanceOf(AgencyNotFound);
      expect(await entryCount()).toBe(0);
    });
  });

  describe("agency checks", () => {
    it("writing to an unknown agency throws and writes nothing", async () => {
      await expect(
        credit({
          agencyId: "no-such-agency",
          type: "TOPUP_BANK",
          amountCents: 100,
          reason: "x",
          idempotencyKey: "k-1",
        }),
      ).rejects.toThrow("Agency not found");
      expect(await db.ledgerEntry.count()).toBe(0);
    });
  });

  describe("entry timestamps follow the lock order", () => {
    it("a write that gets the agency lock later has a createdAt ≥ every existing entry's", async () => {
      await fund();
      await warmPool();
      let releaseBlocker!: () => void;
      const blockerCanFinish = new Promise<void>((resolve) => {
        releaseBlocker = resolve;
      });
      let markLocked!: () => void;
      const blockerHasLock = new Promise<void>((resolve) => {
        markLocked = resolve;
      });
      // Another writer takes the lock first and commits later.
      const blocker = db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "Agency" WHERE id = ${agencyId} FOR UPDATE`;
          markLocked();
          await blockerCanFinish;
          await tx.ledgerEntry.create({
            data: {
              agencyId,
              type: "PAYOUT",
              amountCents: -1000,
              reason: "Payout",
              idempotencyKey: "payout-blocker",
              createdAt: new Date(),
            },
          });
        },
        { timeout: 10_000 },
      );
      await blockerHasLock;

      // This credit's transaction starts now, while the blocker still holds the lock.
      const late = credit({ agencyId, type: "REFUND", amountCents: 500, reason: "x", idempotencyKey: "late" });
      await new Promise((resolve) => setTimeout(resolve, 300));
      releaseBlocker();
      await blocker;
      const entry = await late;

      const others = await db.ledgerEntry.findMany({ where: { agencyId, id: { not: entry.id } } });
      expect(others).toHaveLength(2);
      for (const other of others) {
        expect(entry.createdAt.getTime()).toBeGreaterThanOrEqual(other.createdAt.getTime());
      }
      // So the running balance is never shown below zero, and the newest row is the last write.
      const { entries } = await listEntriesWithBalance(agencyId);
      expect(entries[0]?.id).toBe(entry.id);
      for (const e of entries) expect(e.balanceAfterCents).toBeGreaterThanOrEqual(0);
    });

    it("an entry dated ahead of the clock still sorts before the next write", async () => {
      await fund();
      await db.ledgerEntry.updateMany({ where: { agencyId }, data: { createdAt: new Date(Date.now() + 60_000) } });
      const [ahead] = await db.ledgerEntry.findMany({ where: { agencyId } });
      const next = await credit({ agencyId, type: "REFUND", amountCents: 1, reason: "x", idempotencyKey: "next" });
      expect(next.createdAt.getTime()).toBeGreaterThan(ahead!.createdAt.getTime());
    });

    it("every write of a burst gets a strictly later createdAt, in write order", async () => {
      await fund();
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        ids.push((await credit({ agencyId, type: "REFUND", amountCents: 1, reason: "x", idempotencyKey: `b-${i}` })).id);
      }
      const rows = await db.ledgerEntry.findMany({ where: { id: { in: ids } } });
      const at = new Map(rows.map((r) => [r.id, r.createdAt.getTime()]));
      for (let i = 1; i < ids.length; i++) {
        expect(at.get(ids[i]!)!).toBeGreaterThan(at.get(ids[i - 1]!)!);
      }
    });

    it("a capture writes HOLD_RELEASE before CHARGE (CHARGE strictly later)", async () => {
      await fund(30000);
      const { holdId } = await placeHold({ agencyId, amountCents: 30000, bookingRef: "BK-1", idempotencyKey: "h-1" });
      await captureHold(holdId, "cap-1");
      const release = await db.ledgerEntry.findUniqueOrThrow({ where: { idempotencyKey: "cap-1" } });
      const charge = await db.ledgerEntry.findUniqueOrThrow({ where: { idempotencyKey: "cap-1:charge" } });
      expect(charge.createdAt.getTime()).toBeGreaterThan(release.createdAt.getTime());
      const { entries } = await listEntriesWithBalance(agencyId);
      expect(entries.map((e) => [e.type, e.balanceAfterCents])).toEqual([
        ["CHARGE", 0],
        ["HOLD_RELEASE", 30000],
        ["HOLD", 0],
        ["TOPUP_BANK", 30000],
      ]);
    });

    it("ledger transactions wait at most 5 s for a connection and run at most 10 s", async () => {
      await db.agency.count(); // `db` is a lazy proxy: make sure the real client exists
      const client = (globalThis as unknown as { __apollesDb?: typeof db }).__apollesDb;
      if (!client) throw new Error("no cached Prisma client");
      const spy = vi.spyOn(client, "$transaction");
      try {
        await fund();
        expect(spy).toHaveBeenCalledWith(expect.any(Function), { maxWait: 5000, timeout: 10000 });
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe("listEntries", () => {
    it("pages through all entries newest first without duplicates", async () => {
      // Explicit, distinct timestamps inserted out of order, so "newest first" is deterministic.
      const base = Date.UTC(2026, 0, 1);
      await db.ledgerEntry.createMany({
        data: [4, 1, 7, 3, 6, 2, 5].map((i) => ({
          agencyId,
          type: "TOPUP_BANK" as const,
          amountCents: 1000 * i,
          reason: "seed",
          idempotencyKey: `topup-${i}`,
          createdAt: new Date(base + i * 60_000),
        })),
      });
      const otherId = await createAgency("APL-0002");
      await credit({
        agencyId: otherId,
        type: "TOPUP_BANK",
        amountCents: 999,
        reason: "other",
        idempotencyKey: "other-1",
      });

      const seen: string[] = [];
      const amounts: number[] = [];
      let cursor: string | undefined;
      let pages = 0;
      for (;;) {
        const page = await listEntries(agencyId, cursor, 3);
        pages++;
        expect(page.entries.length).toBeLessThanOrEqual(3);
        for (const e of page.entries) {
          expect(e.agencyId).toBe(agencyId);
          seen.push(e.id);
          amounts.push(e.amountCents);
        }
        if (page.nextCursor === null) break;
        cursor = page.nextCursor;
        expect(pages).toBeLessThan(10);
      }
      expect(pages).toBe(3);
      expect(new Set(seen).size).toBe(7);
      const all = await db.ledgerEntry.findMany({ where: { agencyId }, select: { id: true } });
      expect(new Set(seen)).toEqual(new Set(all.map((e) => e.id)));
      // Amount i was created at minute i, so newest first means descending amounts.
      expect(amounts).toEqual([7000, 6000, 5000, 4000, 3000, 2000, 1000]);
    });

    it("pages correctly through entries that share a createdAt timestamp", async () => {
      await fund();
      for (let i = 1; i <= 3; i++) {
        const { holdId } = await placeHold({
          agencyId,
          amountCents: 1000,
          bookingRef: `BK-${i}`,
          idempotencyKey: `h-${i}`,
        });
        await captureHold(holdId, `cap-${i}`); // writes 2 entries in one transaction
      }
      const seen: string[] = [];
      let cursor: string | undefined;
      for (;;) {
        const page = await listEntries(agencyId, cursor, 1);
        seen.push(...page.entries.map((e) => e.id));
        if (page.nextCursor === null) break;
        cursor = page.nextCursor;
      }
      expect(seen).toHaveLength(10);
      expect(new Set(seen).size).toBe(10);
    });

    it("returns nextCursor null when everything fits, and clamps take to 1..100", async () => {
      await fund();
      const all = await listEntries(agencyId);
      expect(all.entries).toHaveLength(1);
      expect(all.nextCursor).toBeNull();

      await fund(5, "topup-2");
      const one = await listEntries(agencyId, undefined, 0);
      expect(one.entries).toHaveLength(1);
      expect(one.nextCursor).not.toBeNull();

      const big = await listEntries(agencyId, undefined, 1000);
      expect(big.entries).toHaveLength(2);
    });

    it("never returns more than 100 entries per page", async () => {
      await db.ledgerEntry.createMany({
        data: Array.from({ length: 101 }, (_, i) => ({
          agencyId,
          type: "TOPUP_BANK" as const,
          amountCents: 1,
          reason: "seed",
          idempotencyKey: `seed-${i}`,
        })),
      });
      const page = await listEntries(agencyId, undefined, 1000);
      expect(page.entries).toHaveLength(100);
      expect(page.nextCursor).not.toBeNull();
      const rest = await listEntries(agencyId, page.nextCursor ?? undefined, 1000);
      expect(rest.entries).toHaveLength(1);
      expect(rest.nextCursor).toBeNull();
    });

    it("rejects a cursor that belongs to another agency", async () => {
      const otherId = await createAgency("APL-0002");
      const foreign = await credit({
        agencyId: otherId,
        type: "TOPUP_BANK",
        amountCents: 100,
        reason: "x",
        idempotencyKey: "o-1",
      });
      await expect(listEntries(agencyId, foreign.id)).rejects.toThrow("Invalid cursor");
    });
  });

  describe("listEntriesWithBalance", () => {
    // Gives the agency's entries distinct createdAt values in the order they were written, so
    // "newest first" and the running balance are deterministic.
    async function spreadTimestamps(): Promise<void> {
      const rows = await db.ledgerEntry.findMany({
        where: { agencyId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true },
      });
      const base = Date.UTC(2026, 0, 1);
      for (const [i, row] of rows.entries()) {
        await db.ledgerEntry.update({
          where: { id: row.id },
          data: { createdAt: new Date(base + i * 60_000) },
        });
      }
    }

    it("shows the balance after each row across 2 pages, including a hold and its release", async () => {
      await fund(100000); // 100000
      const first = await placeHold({ agencyId, amountCents: 30000, bookingRef: "BK-1", idempotencyKey: "h-1" });
      await spreadTimestamps();
      await releaseHold(first.holdId, "rel-1");
      await spreadTimestamps();
      await placeHold({ agencyId, amountCents: 20000, bookingRef: "BK-2", idempotencyKey: "h-2" });
      await spreadTimestamps();
      await credit({ agencyId, type: "REFUND", amountCents: 2500, reason: "Refund", idempotencyKey: "r-1" });
      await spreadTimestamps();
      // Another agency's money never shows up in this agency's running balance.
      const otherId = await createAgency("APL-0002");
      await credit({ agencyId: otherId, type: "TOPUP_BANK", amountCents: 999, reason: "o", idempotencyKey: "o-1" });

      const page1 = await listEntriesWithBalance(agencyId, undefined, 3);
      expect(page1.entries.map((e) => [e.type, e.amountCents, e.balanceAfterCents])).toEqual([
        ["REFUND", 2500, 82500],
        ["HOLD", -20000, 80000],
        ["HOLD_RELEASE", 30000, 100000],
      ]);
      expect(page1.nextCursor).toBe(page1.entries[2]?.id);

      const page2 = await listEntriesWithBalance(agencyId, page1.nextCursor ?? undefined, 3);
      expect(page2.entries.map((e) => [e.type, e.amountCents, e.balanceAfterCents])).toEqual([
        ["HOLD", -30000, 70000],
        ["TOPUP_BANK", 100000, 100000],
      ]);
      expect(page2.nextCursor).toBeNull();
      for (const e of [...page1.entries, ...page2.entries]) expect(e.agencyId).toBe(agencyId);

      // The newest row's balance is the available balance.
      expect((await getBalance(agencyId)).balanceCents).toBe(82500);
    });

    it("returns the same rows in the same order as listEntries, also with shared timestamps", async () => {
      await fund();
      for (let i = 1; i <= 3; i++) {
        const { holdId } = await placeHold({
          agencyId,
          amountCents: 1000,
          bookingRef: `BK-${i}`,
          idempotencyKey: `h-${i}`,
        });
        await captureHold(holdId, `cap-${i}`);
      }
      // Writes get distinct timestamps; give every row the same one so the id tiebreak is what
      // orders them (both functions must apply it the same way).
      await db.ledgerEntry.updateMany({ where: { agencyId }, data: { createdAt: new Date(Date.UTC(2026, 0, 1)) } });
      const plain: string[] = [];
      const withBalance: { id: string; amountCents: number; balanceAfterCents: number }[] = [];
      let a: string | undefined;
      let b: string | undefined;
      for (let pages = 0; pages < 20; pages++) {
        const p = await listEntries(agencyId, a, 2);
        const q = await listEntriesWithBalance(agencyId, b, 2);
        plain.push(...p.entries.map((e) => e.id));
        withBalance.push(...q.entries);
        expect(q.nextCursor).toBe(p.nextCursor);
        if (p.nextCursor === null) break;
        a = p.nextCursor;
        b = q.nextCursor ?? undefined;
      }
      expect(withBalance.map((e) => e.id)).toEqual(plain);
      expect(plain).toHaveLength(10);
      // Oldest to newest, each balance is the previous one plus the row's amount.
      const ascending = [...withBalance].reverse();
      let running = 0;
      for (const row of ascending) {
        running += row.amountCents;
        expect(row.balanceAfterCents).toBe(running);
      }
      expect(running).toBe((await getBalance(agencyId)).balanceCents);
    });

    it("no entries → empty page", async () => {
      expect(await listEntriesWithBalance(agencyId)).toEqual({ entries: [], nextCursor: null });
    });

    it("clamps take to 1..100", async () => {
      await fund();
      await fund(5, "topup-2");
      const one = await listEntriesWithBalance(agencyId, undefined, 0);
      expect(one.entries).toHaveLength(1);
      expect(one.nextCursor).not.toBeNull();
      expect((await listEntriesWithBalance(agencyId, undefined, 1000)).entries).toHaveLength(2);
    });

    it("rejects an unknown cursor or one that belongs to another agency", async () => {
      const otherId = await createAgency("APL-0002");
      const foreign = await credit({
        agencyId: otherId,
        type: "TOPUP_BANK",
        amountCents: 100,
        reason: "x",
        idempotencyKey: "o-1",
      });
      await expect(listEntriesWithBalance(agencyId, foreign.id)).rejects.toThrow("Invalid cursor");
      await expect(listEntriesWithBalance(agencyId, "nope")).rejects.toThrow("Invalid cursor");
    });
  });
});
