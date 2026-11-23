// Sign-in throttling rules (lockout.ts, login.ts).
//
// Password step: wrong passwords are counted per email address in time windows (RateLimitBucket),
// never by locking the account. An attacker who only knows an email address fills the pools of
// their own networks, not the owner's: the owner signs in from another network, or from a
// browser where they finished a sign-in before (device cookie), and always reaches the second
// step (email code for agents, authenticator code for admins). Every pool is taken BEFORE the
// password is checked, so parallel guesses can never check more passwords than a pool allows.
// The longer windows make repeated guessing slower and slower; every window ends by itself, so
// old failures stop counting (the counter decays). Unknown and real addresses are counted the
// same way, so the answers do not tell which addresses have an account.
export type PasswordWindow = { readonly limit: number; readonly windowMs: number };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const PASSWORD_POOLS = {
  // One email address from one network (IPv4 address or IPv6 /64).
  network: [
    { limit: 3, windowMs: 15 * MINUTE },
    { limit: 10, windowMs: 24 * HOUR },
  ],
  // One email address from every network together: caps a guesser spread over many networks.
  account: [
    { limit: 20, windowMs: HOUR },
    { limit: 50, windowMs: 24 * HOUR },
  ],
  // A browser where this user finished a sign-in before: its own pool, so wrong guesses from
  // anywhere else never stop the owner there. The account pool does not apply to it.
  device: [
    { limit: 3, windowMs: 15 * MINUTE },
    { limit: 10, windowMs: 24 * HOUR },
  ],
} as const satisfies Record<string, readonly PasswordWindow[]>;

// At most one "sign-in paused" alert email per account per hour.
export const LOCK_ALERT_WINDOW_MS = HOUR;

// Second step (admin authenticator code, agent email code): only someone who just gave the right
// password reaches it. This many wrong codes in a row lock the second step for LOCK_DURATION_MS
// and alert the admin. Failures stop counting once SECOND_STEP_DECAY_MS pass with no attempt.
export const MAX_FAILED_LOGINS = 3;
export const LOCK_DURATION_MS = 15 * MINUTE;
export const SECOND_STEP_DECAY_MS = 15 * MINUTE;

// A row whose attempt slots are all taken, with no lock, and whose last slot was taken longer
// ago than this was left by a request that died between taking a slot and giving it back.
// The next attempt turns it into a normal timed lock (lockout.ts). Far longer than any
// request can hold a slot (argon2 < 1 s, ledger transaction timeout 10 s), so a slot that is
// still in flight is never mistaken for a stuck one. Shorter than SECOND_STEP_DECAY_MS, so a
// stuck row is healed before it would decay.
export const STUCK_RESERVATION_MS = 2 * MINUTE;
