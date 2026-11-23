// Result of one wallet form (top-up, payout, adjustment).
// success: the entry was written · info: it was already recorded, nothing changed · error: nothing written.
// duplicate: it looks like an entry already recorded and nothing was written; the form stays on
// its confirm step, and confirming again records it anyway.
export type WalletFormState = { status: "success" | "info" | "error" | "duplicate"; message: string } | null;
