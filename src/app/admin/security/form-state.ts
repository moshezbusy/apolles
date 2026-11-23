// Result of "Make recovery codes". `codes` is set only in the answer to the request that made
// them: they are shown once and never stored in plain text.
export type RecoveryFormState = { status: "success" | "error"; message: string; codes?: string[] } | null;
