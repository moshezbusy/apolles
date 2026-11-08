import { z } from "zod";
import type { LedgerEntry } from "@/generated/prisma/client";
import { MAX_AMOUNT_CENTS } from "@/lib/money";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { IdempotencyKeyConflict, TopupRefConflict } from "@/server/wallet/errors";
import {
  creditInTx,
  debitInTx,
  getBalance,
  listEntries,
  withLedgerTransaction,
  type Balance,
} from "@/server/wallet/ledger";

// Admin money actions on an agency's wallet: bank top-ups, payouts and adjustments.
// The caller (a server action) has already run requireAdmin() and passes the admin's user id
// as `actor`. Each action is ONE transaction: the ledger entry and its audit row commit or roll
// back together. A repeat (same idempotency key, same details) writes nothing, no audit row
// either, and returns the original entry with `alreadyRecorded: true`.

export type MoneyResult = { entry: LedgerEntry; alreadyRecorded: boolean };

const EARLIEST_RECEIVED_ON = "2020-01-01";

const agencyId = z.string().min(1).max(100);
const positiveCents = z.number().int().min(1).max(MAX_AMOUNT_CENTS);
const signedCents = z
  .number()
  .int()
  .min(-MAX_AMOUNT_CENTS)
  .max(MAX_AMOUNT_CENTS)
  .refine((n) => n !== 0, "Amount must not be zero");

// "abc 1" and " ABC  1 " are the same transfer: trim, collapse inner whitespace, uppercase.
export function normalizeBankTransferRef(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toUpperCase();
}

// The latest calendar date anywhere on Earth right now (UTC+14). The server does not know the
// admin's time zone; with this bound "today" is never refused as being in the future, and at
// most one day ahead of the admin's date can slip through.
function latestAllowedDay(): string {
  return new Date(Date.now() + 14 * 3_600_000).toISOString().slice(0, 10);
}

function isRealDay(day: string): boolean {
  const date = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === day;
}

const receivedOn = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD")
  .refine(isRealDay, "Not a real date")
  .refine((day) => day >= EARLIEST_RECEIVED_ON, "Must not be before 2020-01-01")
  .refine((day) => day <= latestAllowedDay(), "Must not be in the future");

export const bankTopupInput = z
  .object({
    agencyId,
    amountCents: positiveCents,
    bankTransferRef: z.string().max(500).transform(normalizeBankTransferRef).pipe(z.string().min(1).max(100)),
    receivedOn,
  })
  .strict();

// `idempotencyKey` is the UUID the wallet page put in the form; the service adds the
// "payout:" / "adjust:" prefix itself, so the two kinds can never share a key.
export const payoutInput = z
  .object({
    agencyId,
    amountCents: positiveCents,
    note: z.string().trim().min(1).max(500),
    idempotencyKey: z.uuid(),
  })
  .strict();

export const adjustmentInput = z
  .object({
    agencyId,
    amountCents: signedCents,
    reason: z.string().trim().min(5).max(500),
    idempotencyKey: z.uuid(),
  })
  .strict();

export type BankTopupInput = z.input<typeof bankTopupInput>;
export type PayoutInput = z.input<typeof payoutInput>;
export type AdjustmentInput = z.input<typeof adjustmentInput>;

// Records a bank transfer the admin saw arrive. The key is "topup:" + the normalized ref, so
// the same transfer can never be credited twice:
//   same ref, same agency, same amount → the original entry, alreadyRecorded: true
//   same ref, other amount or agency   → TopupRefConflict (names only the original amount)
export async function confirmBankTopup(actor: string, raw: BankTopupInput): Promise<MoneyResult> {
  const input = bankTopupInput.parse(raw);
  const idempotencyKey = `topup:${input.bankTransferRef}`;
  const reason = `Bank transfer ${input.bankTransferRef} received ${input.receivedOn}`;

  const repeatOrConflict = (existing: LedgerEntry): MoneyResult => {
    if (
      existing.agencyId === input.agencyId &&
      existing.type === "TOPUP_BANK" &&
      existing.amountCents === input.amountCents
    ) {
      return { entry: existing, alreadyRecorded: true };
    }
    throw new TopupRefConflict(Math.abs(existing.amountCents));
  };

  try {
    return await withLedgerTransaction(async (tx) => {
      const { entry, created } = await creditInTx(tx, {
        agencyId: input.agencyId,
        type: "TOPUP_BANK",
        amountCents: input.amountCents,
        reason,
        actorUserId: actor,
        idempotencyKey,
      });
      if (!created) return repeatOrConflict(entry);
      await audit(
        actor,
        "wallet.topup",
        "Agency",
        input.agencyId,
        undefined,
        {
          entryId: entry.id,
          type: entry.type,
          amountCents: entry.amountCents,
          currency: entry.currency,
          bankTransferRef: input.bankTransferRef,
          receivedOn: input.receivedOn,
          reason,
        },
        tx,
      );
      return { entry, alreadyRecorded: false };
    });
  } catch (error) {
    // The key belongs to another agency (or the unique-index race lost twice): nothing was
    // written. Read the committed entry only to tell the admin its amount.
    if (!(error instanceof IdempotencyKeyConflict)) throw error;
    const existing = await db.ledgerEntry.findUnique({ where: { idempotencyKey } });
    if (!existing) throw error;
    return repeatOrConflict(existing);
  }
}

// Shared by payouts and adjustments. `signedCents` > 0 credits, < 0 debits |signedCents|
// (InsufficientFunds if the available balance cannot cover it). A repeat of the same key with
// a different amount is not a repeat: IdempotencyKeyConflict, nothing written.
async function recordAdminEntry(
  actor: string,
  args: {
    agencyId: string;
    type: "PAYOUT" | "ADJUSTMENT";
    signedCents: number;
    reason: string;
    idempotencyKey: string;
    action: "wallet.payout" | "wallet.adjustment";
  },
): Promise<MoneyResult> {
  const { agencyId: id, type, signedCents: signed, reason, idempotencyKey, action } = args;
  return withLedgerTransaction(async (tx) => {
    const { entry, created } =
      signed > 0 && type === "ADJUSTMENT"
        ? await creditInTx(tx, { agencyId: id, type, amountCents: signed, reason, actorUserId: actor, idempotencyKey })
        : await debitInTx(tx, { agencyId: id, type, amountCents: -signed, reason, actorUserId: actor, idempotencyKey });
    if (!created) {
      if (entry.amountCents !== signed) throw new IdempotencyKeyConflict();
      return { entry, alreadyRecorded: true };
    }
    await audit(
      actor,
      action,
      "Agency",
      id,
      undefined,
      { entryId: entry.id, type: entry.type, amountCents: entry.amountCents, currency: entry.currency, reason },
      tx,
    );
    return { entry, alreadyRecorded: false };
  });
}

// Money paid back out of the wallet (e.g. to the agency's bank). Cannot exceed the available
// balance. The note is the entry's reason.
export async function recordPayout(actor: string, raw: PayoutInput): Promise<MoneyResult> {
  const input = payoutInput.parse(raw);
  return recordAdminEntry(actor, {
    agencyId: input.agencyId,
    type: "PAYOUT",
    signedCents: -input.amountCents,
    reason: input.note,
    idempotencyKey: `payout:${input.idempotencyKey}`,
    action: "wallet.payout",
  });
}

// A signed correction. Positive adds money; negative takes it out and may not take the
// available balance below zero.
export async function recordAdjustment(actor: string, raw: AdjustmentInput): Promise<MoneyResult> {
  const input = adjustmentInput.parse(raw);
  return recordAdminEntry(actor, {
    agencyId: input.agencyId,
    type: "ADJUSTMENT",
    signedCents: input.amountCents,
    reason: input.reason,
    idempotencyKey: `adjust:${input.idempotencyKey}`,
    action: "wallet.adjustment",
  });
}

export type AgencyWallet = {
  agency: { id: string; name: string; bankReference: string };
  balance: Balance;
  entries: LedgerEntry[];
  nextCursor: string | null;
};

// For the admin wallet page: the agency, its balance and one page of ledger history
// (newest first). null if the agency does not exist. Throws "Invalid cursor" for a cursor
// that is not an entry of this agency.
export async function getAgencyWallet(id: string, cursor?: string): Promise<AgencyWallet | null> {
  const agency = await db.agency.findUnique({
    where: { id },
    select: { id: true, name: true, bankReference: true },
  });
  if (!agency) return null;
  const [balance, page] = await Promise.all([getBalance(id), listEntries(id, cursor)]);
  return { agency, balance, ...page };
}
