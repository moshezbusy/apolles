// Sign-in lockout rule: this many consecutive wrong passwords lock the account for
// LOCK_DURATION_MS and alert the admin.
export const MAX_FAILED_LOGINS = 3;
export const LOCK_DURATION_MS = 15 * 60 * 1000;
