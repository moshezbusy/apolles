// Sign-in lockout rule: this many consecutive wrong passwords lock the account for
// LOCK_DURATION_MS and alert the admin.
export const MAX_FAILED_LOGINS = 3;
export const LOCK_DURATION_MS = 15 * 60 * 1000;

// A row whose attempt slots are all taken, with no lock, and whose last slot was taken longer
// ago than this was left by a request that died between taking a slot and giving it back.
// The next attempt turns it into a normal timed lock (lockout.ts). Far longer than any
// request can hold a slot (argon2 < 1 s, ledger transaction timeout 10 s), so a slot that is
// still in flight is never mistaken for a stuck one.
export const STUCK_RESERVATION_MS = 2 * 60_000;
