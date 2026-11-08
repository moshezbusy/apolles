import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createUser } from "@/server/users";
import { resetTestDb } from "@/test/db";
import {
  HoldNotOpen,
  IdempotencyKeyConflict,
  InsufficientFunds,
  InvalidAmount,
} from "@/server/wallet/errors";
import {
  captureHold,
  credit,
  debit,
  getBalance,
  listEntries,
  placeHold,
  releaseHold,
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
});
