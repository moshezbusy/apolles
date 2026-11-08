import { randomUUID } from "node:crypto";
import { Prisma, type LedgerEntry } from "@/generated/prisma/client";
import { MAX_AMOUNT_CENTS } from "@/lib/money"; // LedgerEntry.amountCents is a Postgres int4.
import { db } from "@/server/db";
import {
  AgencyNotFound,
  HoldNotOpen,
  IdempotencyKeyConflict,
  InsufficientFunds,
  InvalidAmount,
} from "@/server/wallet/errors";

// Append-only wallet ledger, one per agency. Entries are never updated or deleted.
//
// Balance:  balanceCents = SUM(amountCents) over all of the agency's entries. A HOLD is
//           negative, so an open hold already reduces it: this is the *available* balance.
// Holds:    a HOLD(-X) gets a fresh holdId. It is open until a HOLD_RELEASE(+X) with the same
//           holdId exists. Release writes only HOLD_RELEASE(+X); capture writes HOLD_RELEASE(+X)
//           and CHARGE(-X) together.
// Writes:   every write runs in one transaction that first locks the agency row
//           (SELECT ... FOR UPDATE), so writes for one agency happen one at a time and the
//           balance / hold state read inside the lock is current.
// Idempotency: each entry has a globally unique idempotencyKey. A call whose key already
//           exists for the same agency and the same operation returns the original result and
//           writes nothing (even if amount / reason differ: the first call wins). A key that
//           belongs to another agency or another operation throws IdempotencyKeyConflict.
// In a caller's transaction: creditInTx / debitInTx (or credit / debit with `tx`) do the same
//           work inside a transaction the caller opened with withLedgerTransaction, so the
//           caller can write more rows (e.g. an audit row) that commit or roll back together
//           with the entry. They still lock the agency row first. `created` tells the caller
//           whether this call wrote the entry (false = a repeat that returned the original).

type Tx = Prisma.TransactionClient;

const CURRENCY = "USD"; // Phase 1 is USD only.
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

const CREDIT_TYPES = ["TOPUP_BANK", "REFUND", "ADJUSTMENT"] as const;
const DEBIT_TYPES = ["PAYOUT", "ADJUSTMENT"] as const;

export type CreditType = (typeof CREDIT_TYPES)[number];
export type DebitType = (typeof DEBIT_TYPES)[number];

export type CreditInput = {
  agencyId: string;
  type: CreditType;
  amountCents: number;
  reason: string;
  actorUserId?: string;
  idempotencyKey: string;
  bookingRef?: string;
};

export type DebitInput = {
  agencyId: string;
  type: DebitType;
  amountCents: number;
  reason: string;
  actorUserId: string;
  idempotencyKey: string;
};

export type PlaceHoldInput = {
  agencyId: string;
  amountCents: number;
  bookingRef: string;
  idempotencyKey: string;
};

export type Balance = { balanceCents: number; heldCents: number };

function assertValidAmount(amountCents: number): void {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > MAX_AMOUNT_CENTS) {
    throw new InvalidAmount();
  }
}

function assertKey(idempotencyKey: string): void {
  if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0) {
    throw new Error("idempotencyKey is required");
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function toSafeNumber(value: bigint | number | string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error("Ledger sum is out of safe integer range");
  return n;
}

// Locks the agency row for the rest of the transaction. Writes for one agency happen one at a
// time, and every read after the lock sees what earlier writers committed.
async function lockAgency(tx: Tx, agencyId: string): Promise<void> {
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Agency" WHERE id = ${agencyId} FOR UPDATE`;
  if (locked.length === 0) throw new AgencyNotFound();
}

// Runs `fn` in one transaction. If the unique index on idempotencyKey still fires (a race the
// agency lock cannot cover, e.g. the same key used for another agency at the same moment), the
// transaction is rolled back and `fn` runs once more: the repeat check inside the lock then
// sees the committed entry and returns it or reports the conflict. The caller never gets a raw
// duplicate-key error and nothing is written twice. `fn` must only change the database through
// `tx` (it may run twice) and must lock the agency before writing (creditInTx / debitInTx do).
export async function withLedgerTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const run = () => db.$transaction(fn);
  try {
    return await run();
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }
  try {
    return await run();
  } catch (error) {
    if (isUniqueViolation(error)) throw new IdempotencyKeyConflict();
    throw error;
  }
}

async function withAgencyLock<T>(agencyId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withLedgerTransaction(async (tx) => {
    await lockAgency(tx, agencyId);
    return fn(tx);
  });
}

// Both numbers come from one aggregate query; rows are never loaded into memory.
async function readBalance(client: Tx, agencyId: string): Promise<Balance> {
  const rows = await client.$queryRaw<{ balance: bigint; held: bigint }[]>`
    SELECT
      COALESCE(SUM(e."amountCents"), 0)::bigint AS balance,
      COALESCE(SUM(-e."amountCents") FILTER (
        WHERE e."type" = 'HOLD' AND NOT EXISTS (
          SELECT 1 FROM "LedgerEntry" r
          WHERE r."holdId" = e."holdId"
            AND r."agencyId" = e."agencyId"
            AND r."type" = 'HOLD_RELEASE'
        )
      ), 0)::bigint AS held
    FROM "LedgerEntry" e
    WHERE e."agencyId" = ${agencyId}`;
  const row = rows[0];
  if (!row) return { balanceCents: 0, heldCents: 0 };
  return { balanceCents: toSafeNumber(row.balance), heldCents: toSafeNumber(row.held) };
}

// Balances of many agencies in ONE grouped query (no N+1). Same meaning as getBalance;
// an agency without entries gets zeros.
export async function getBalances(agencyIds: string[]): Promise<Map<string, Balance>> {
  const result = new Map<string, Balance>();
  if (agencyIds.length === 0) return result;
  for (const id of agencyIds) result.set(id, { balanceCents: 0, heldCents: 0 });
  const rows = await db.$queryRaw<{ agencyId: string; balance: bigint; held: bigint }[]>`
    SELECT
      e."agencyId" AS "agencyId",
      COALESCE(SUM(e."amountCents"), 0)::bigint AS balance,
      COALESCE(SUM(-e."amountCents") FILTER (
        WHERE e."type" = 'HOLD' AND NOT EXISTS (
          SELECT 1 FROM "LedgerEntry" r
          WHERE r."holdId" = e."holdId"
            AND r."agencyId" = e."agencyId"
            AND r."type" = 'HOLD_RELEASE'
        )
      ), 0)::bigint AS held
    FROM "LedgerEntry" e
    WHERE e."agencyId" = ANY(${agencyIds})
    GROUP BY e."agencyId"`;
  for (const row of rows) {
    result.set(row.agencyId, {
      balanceCents: toSafeNumber(row.balance),
      heldCents: toSafeNumber(row.held),
    });
  }
  return result;
}

async function findByKey(tx: Tx, idempotencyKey: string): Promise<LedgerEntry | null> {
  return tx.ledgerEntry.findUnique({ where: { idempotencyKey } });
}

export async function getBalance(agencyId: string): Promise<Balance> {
  return readBalance(db, agencyId);
}

export type WriteResult = { entry: LedgerEntry; created: boolean };

function assertCreditInput(input: CreditInput): void {
  assertValidAmount(input.amountCents);
  assertKey(input.idempotencyKey);
  if (!CREDIT_TYPES.includes(input.type)) throw new Error("Invalid credit type");
}

function assertDebitInput(input: DebitInput): void {
  assertValidAmount(input.amountCents);
  assertKey(input.idempotencyKey);
  if (!DEBIT_TYPES.includes(input.type)) throw new Error("Invalid debit type");
}

// The agency is already locked in `tx`.
async function writeCredit(tx: Tx, input: CreditInput): Promise<WriteResult> {
  const existing = await findByKey(tx, input.idempotencyKey);
  if (existing) {
    if (
      existing.agencyId === input.agencyId &&
      existing.type === input.type &&
      existing.amountCents > 0
    ) {
      return { entry: existing, created: false };
    }
    throw new IdempotencyKeyConflict();
  }
  const entry = await tx.ledgerEntry.create({
    data: {
      agencyId: input.agencyId,
      type: input.type,
      amountCents: input.amountCents,
      currency: CURRENCY,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
      ...(input.actorUserId !== undefined ? { actorUserId: input.actorUserId } : {}),
      ...(input.bookingRef !== undefined ? { bookingRef: input.bookingRef } : {}),
    },
  });
  return { entry, created: true };
}

// The agency is already locked in `tx`.
async function writeDebit(tx: Tx, input: DebitInput): Promise<WriteResult> {
  const existing = await findByKey(tx, input.idempotencyKey);
  if (existing) {
    if (
      existing.agencyId === input.agencyId &&
      existing.type === input.type &&
      existing.amountCents < 0
    ) {
      return { entry: existing, created: false };
    }
    throw new IdempotencyKeyConflict();
  }
  const { balanceCents } = await readBalance(tx, input.agencyId);
  if (balanceCents < input.amountCents) throw new InsufficientFunds();
  const entry = await tx.ledgerEntry.create({
    data: {
      agencyId: input.agencyId,
      type: input.type,
      amountCents: -input.amountCents,
      currency: CURRENCY,
      reason: input.reason,
      actorUserId: input.actorUserId,
      idempotencyKey: input.idempotencyKey,
    },
  });
  return { entry, created: true };
}

// credit() inside the caller's transaction (see withLedgerTransaction). Locks the agency first.
export async function creditInTx(tx: Tx, input: CreditInput): Promise<WriteResult> {
  assertCreditInput(input);
  await lockAgency(tx, input.agencyId);
  return writeCredit(tx, input);
}

// debit() inside the caller's transaction (see withLedgerTransaction). Locks the agency first.
export async function debitInTx(tx: Tx, input: DebitInput): Promise<WriteResult> {
  assertDebitInput(input);
  await lockAgency(tx, input.agencyId);
  return writeDebit(tx, input);
}

// Adds money to the wallet. Never fails on balance. With `tx`, runs inside that transaction.
export async function credit(input: CreditInput, tx?: Tx): Promise<LedgerEntry> {
  if (tx) return (await creditInTx(tx, input)).entry;
  assertCreditInput(input);
  return (await withAgencyLock(input.agencyId, (t) => writeCredit(t, input))).entry;
}

// Takes money out of the wallet. The available balance may never go below zero.
// With `tx`, runs inside that transaction.
export async function debit(input: DebitInput, tx?: Tx): Promise<LedgerEntry> {
  if (tx) return (await debitInTx(tx, input)).entry;
  assertDebitInput(input);
  return (await withAgencyLock(input.agencyId, (t) => writeDebit(t, input))).entry;
}

// Reserves money for a booking. The available balance may never go below zero.
export async function placeHold(input: PlaceHoldInput): Promise<{ holdId: string }> {
  assertValidAmount(input.amountCents);
  assertKey(input.idempotencyKey);

  return withAgencyLock(input.agencyId, async (tx) => {
    const existing = await findByKey(tx, input.idempotencyKey);
    if (existing) {
      if (existing.agencyId === input.agencyId && existing.type === "HOLD" && existing.holdId) {
        return { holdId: existing.holdId };
      }
      throw new IdempotencyKeyConflict();
    }
    const { balanceCents } = await readBalance(tx, input.agencyId);
    if (balanceCents < input.amountCents) throw new InsufficientFunds();
    const holdId = randomUUID();
    await tx.ledgerEntry.create({
      data: {
        agencyId: input.agencyId,
        type: "HOLD",
        amountCents: -input.amountCents,
        currency: CURRENCY,
        holdId,
        bookingRef: input.bookingRef,
        reason: `Hold for booking ${input.bookingRef}`,
        idempotencyKey: input.idempotencyKey,
      },
    });
    return { holdId };
  });
}

// Closes an open hold. Release: HOLD_RELEASE(+X) under `key`. Capture: HOLD_RELEASE(+X) under
// `key` and CHARGE(-X) under `${key}:charge`, in the same transaction.
async function closeHold(holdId: string, key: string, capture: boolean): Promise<void> {
  assertKey(key);
  // The HOLD entry is immutable, so reading it before taking the lock is safe.
  const hold = await db.ledgerEntry.findFirst({ where: { holdId, type: "HOLD" } });
  if (!hold) throw new HoldNotOpen();
  const chargeKey = `${key}:charge`;

  await withAgencyLock(hold.agencyId, async (tx) => {
    const existing = await findByKey(tx, key);
    const existingCharge = await findByKey(tx, chargeKey);
    if (existing) {
      if (existing.type !== "HOLD_RELEASE" || existing.holdId !== holdId) {
        throw new IdempotencyKeyConflict();
      }
      const wasCapture = existingCharge?.type === "CHARGE" && existingCharge.holdId === holdId;
      if (wasCapture === capture) return; // Repeat of this same call: nothing to write.
      throw new HoldNotOpen(); // This key already closed the hold the other way.
    }
    if (capture && existingCharge) throw new IdempotencyKeyConflict();

    const alreadyClosed = await tx.ledgerEntry.findFirst({
      where: { holdId, type: "HOLD_RELEASE" },
      select: { id: true },
    });
    if (alreadyClosed) throw new HoldNotOpen();

    const amountCents = -hold.amountCents; // HOLD is stored negative.
    await tx.ledgerEntry.create({
      data: {
        agencyId: hold.agencyId,
        type: "HOLD_RELEASE",
        amountCents,
        currency: CURRENCY,
        holdId,
        bookingRef: hold.bookingRef,
        reason: capture ? "Hold captured" : "Hold released",
        idempotencyKey: key,
      },
    });
    if (capture) {
      await tx.ledgerEntry.create({
        data: {
          agencyId: hold.agencyId,
          type: "CHARGE",
          amountCents: -amountCents,
          currency: CURRENCY,
          holdId,
          bookingRef: hold.bookingRef,
          reason: hold.bookingRef ? `Charge for booking ${hold.bookingRef}` : "Charge",
          idempotencyKey: chargeKey,
        },
      });
    }
  });
}

export async function releaseHold(holdId: string, idempotencyKey: string): Promise<void> {
  await closeHold(holdId, idempotencyKey, false);
}

export async function captureHold(holdId: string, idempotencyKey: string): Promise<void> {
  await closeHold(holdId, idempotencyKey, true);
}

function clampTake(take: number): number {
  if (!Number.isFinite(take)) return DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(take)));
}

// Newest first (createdAt desc, id desc). `cursor` is the id of the last entry of the
// previous page and must belong to the same agency.
export async function listEntries(
  agencyId: string,
  cursor?: string,
  take = DEFAULT_PAGE_SIZE,
): Promise<{ entries: LedgerEntry[]; nextCursor: string | null }> {
  const size = clampTake(take);
  let where: Prisma.LedgerEntryWhereInput = { agencyId };
  if (cursor !== undefined) {
    const after = await db.ledgerEntry.findFirst({
      where: { id: cursor, agencyId },
      select: { id: true, createdAt: true },
    });
    if (!after) throw new Error("Invalid cursor");
    where = {
      agencyId,
      OR: [
        { createdAt: { lt: after.createdAt } },
        { createdAt: after.createdAt, id: { lt: after.id } },
      ],
    };
  }
  const rows = await db.ledgerEntry.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: size + 1,
  });
  const hasMore = rows.length > size;
  const entries = hasMore ? rows.slice(0, size) : rows;
  const last = entries[entries.length - 1];
  return { entries, nextCursor: hasMore && last ? last.id : null };
}

export type LedgerEntryWithBalance = LedgerEntry & { balanceAfterCents: number };

type RunningRow = LedgerEntry & { balanceAfter: bigint };

// listEntries plus, for each row, the agency's available balance right after that entry.
// Same order (createdAt desc, id desc), page size and cursor rules as listEntries.
// The running balance comes from ONE query: a window SUM over all of the agency's entries,
// oldest first in exactly the reverse of the page order, so the newest row's balance equals
// getBalance().balanceCents. Rows are never summed in memory.
export async function listEntriesWithBalance(
  agencyId: string,
  cursor?: string,
  take = DEFAULT_PAGE_SIZE,
): Promise<{ entries: LedgerEntryWithBalance[]; nextCursor: string | null }> {
  const size = clampTake(take);
  let after: { id: string } | null = null;
  if (cursor !== undefined) {
    after = await db.ledgerEntry.findFirst({ where: { id: cursor, agencyId }, select: { id: true } });
    if (!after) throw new Error("Invalid cursor");
  }
  // Compared with the cursor row's own stored values (not a Date sent from here), so the
  // comparison is exactly the one listEntries makes.
  const afterFilter = after
    ? Prisma.sql`WHERE ("createdAt", id) < (
        SELECT c."createdAt", c.id FROM "LedgerEntry" c
        WHERE c.id = ${after.id} AND c."agencyId" = ${agencyId})`
    : Prisma.empty;
  const rows = await db.$queryRaw<RunningRow[]>`
    SELECT id, "agencyId", "type"::text AS "type", "amountCents", currency, "holdId",
           "bookingRef", reason, "actorUserId", "idempotencyKey", "createdAt", "balanceAfter"
    FROM (
      SELECT e.*,
             SUM(e."amountCents") OVER (ORDER BY e."createdAt", e.id)::bigint AS "balanceAfter"
      FROM "LedgerEntry" e
      WHERE e."agencyId" = ${agencyId}
    ) running
    ${afterFilter}
    ORDER BY "createdAt" DESC, id DESC
    LIMIT ${size + 1}`;
  const hasMore = rows.length > size;
  const page = hasMore ? rows.slice(0, size) : rows;
  const entries = page.map(({ balanceAfter, ...entry }) => ({
    ...entry,
    balanceAfterCents: toSafeNumber(balanceAfter),
  }));
  const last = entries[entries.length - 1];
  return { entries, nextCursor: hasMore && last ? last.id : null };
}
