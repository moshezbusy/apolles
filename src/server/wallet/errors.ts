import type { LedgerEntry } from "@/generated/prisma/client";
import { formatUsd } from "@/lib/money";

// Wallet errors. Each has a stable `name` so callers can use `instanceof` or check `name`.

// The agency's available balance (all entries, open holds included) cannot cover the amount.
export class InsufficientFunds extends Error {
  override readonly name = "InsufficientFunds";
  constructor(message = "Insufficient funds") {
    super(message);
  }
}

// The hold does not exist, or it was already released or captured.
export class HoldNotOpen extends Error {
  override readonly name = "HoldNotOpen";
  constructor(message = "Hold is not open") {
    super(message);
  }
}

// amountCents must be a safe integer, > 0 and <= 2,147,483,647.
export class InvalidAmount extends Error {
  override readonly name = "InvalidAmount";
  constructor(message = "Amount must be a whole number of cents between 1 and 2147483647") {
    super(message);
  }
}

// The idempotency key is already used by a different operation or another agency, so this
// call is not a repeat. Nothing is written and nothing about the other entry is returned.
export class IdempotencyKeyConflict extends Error {
  override readonly name = "IdempotencyKeyConflict";
  constructor(message = "Idempotency key already used for a different operation") {
    super(message);
  }
}

// The agency to write to does not exist.
export class AgencyNotFound extends Error {
  override readonly name = "AgencyNotFound";
  constructor(message = "Agency not found") {
    super(message);
  }
}

// A bank top-up whose (normalized) transfer reference was already recorded with a different
// amount or for another agency. The message names only the original amount, never the agency.
export class TopupRefConflict extends Error {
  override readonly name = "TopupRefConflict";
  readonly originalAmountCents: number;
  constructor(originalAmountCents: number) {
    super(`This bank transfer reference was already recorded for ${formatUsd(originalAmountCents)}.`);
    this.originalAmountCents = originalAmountCents;
  }
}

// An admin entry that looks like one already recorded for the agency (the same kind and amount
// a few minutes ago, or a top-up of the same amount and received date). Nothing was written:
// the admin confirms again to record it anyway. `existing` is the entry it looks like.
export class PossibleDuplicate extends Error {
  override readonly name = "PossibleDuplicate";
  readonly existing: Pick<LedgerEntry, "id" | "type" | "amountCents" | "reason" | "createdAt">;
  constructor(existing: Pick<LedgerEntry, "id" | "type" | "amountCents" | "reason" | "createdAt">) {
    super("This looks like a duplicate of an entry that is already recorded.");
    this.existing = { id: existing.id, type: existing.type, amountCents: existing.amountCents, reason: existing.reason, createdAt: existing.createdAt };
  }
}
