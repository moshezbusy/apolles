import type { LedgerEntryType } from "@/generated/prisma/enums";

// How each ledger entry type is named on the agent balance page.
export const TYPE_LABEL: Record<LedgerEntryType, string> = {
  TOPUP_BANK: "Top-up · bank transfer",
  HOLD: "Hold",
  HOLD_RELEASE: "Hold released",
  CHARGE: "Booking charge",
  REFUND: "Refund",
  PAYOUT: "Payout",
  ADJUSTMENT: "Adjustment",
};
