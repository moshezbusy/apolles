// Result of one wallet form (top-up, payout, adjustment).
// success: the entry was written · info: it was already recorded, nothing changed · error: nothing written.
export type WalletFormState = { status: "success" | "info" | "error"; message: string } | null;
