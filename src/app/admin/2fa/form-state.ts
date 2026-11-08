// State of the TOTP code forms (/admin/2fa and /admin/2fa/setup).
// `locked`: the account was locked and this browser signed out; the form is not shown again.
export type TotpFormState = { error: string; locked?: true } | null;
