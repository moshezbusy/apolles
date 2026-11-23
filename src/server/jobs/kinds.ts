// Every kind of background job. Each one has a handler in handlers.ts.
export const JOB_KINDS = [
  "content.regions",
  "content.catalog",
  "content.inactive",
  "search.cleanup",
  "booking.reconcile",
  "booking.sweep",
  "booking.supplier-check",
  "supplier-log.cleanup",
  "cleanup.daily",
  "email.booking",
  "email.topup",
  "email.low-balance",
  "booking.cancel-reminders",
] as const;
export type JobKind = (typeof JOB_KINDS)[number];

// Jobs that can run for a long time: the content syncs, the daily check of confirmed bookings at
// the supplier and the daily cleanup. They never hold up a booking check or an email: those are
// claimed first, and the worker runs the long jobs in a lane of their own (queue.ts, worker.ts).
export const LONG_KINDS: readonly JobKind[] = ["content.regions", "content.catalog", "content.inactive", "booking.supplier-check", "cleanup.daily"];

// Emails: a mail provider can be down for hours, so these are tried for a day before giving up.
export const EMAIL_KINDS: readonly JobKind[] = ["email.booking", "email.topup", "email.low-balance"];

// How a failed job is tried again: the waits between attempts, in minutes. The number of
// attempts is one more than the number of waits. Booking and money jobs stay fast (their own
// logic schedules the next check); emails are spread over a little more than 24 hours.
const DEFAULT_BACKOFF_MINUTES: readonly number[] = [1, 5];
const EMAIL_BACKOFF_MINUTES: readonly number[] = [1, 5, 30, 120, 240, 360, 720];
export const DEFAULT_MAX_ATTEMPTS = DEFAULT_BACKOFF_MINUTES.length + 1;
export const EMAIL_MAX_ATTEMPTS = EMAIL_BACKOFF_MINUTES.length + 1;

export function retryPolicy(kind: string): { maxAttempts: number; backoffMinutes: readonly number[] } {
  const email = EMAIL_KINDS.some((k) => k === kind);
  return email ? { maxAttempts: EMAIL_MAX_ATTEMPTS, backoffMinutes: EMAIL_BACKOFF_MINUTES } : { maxAttempts: DEFAULT_MAX_ATTEMPTS, backoffMinutes: DEFAULT_BACKOFF_MINUTES };
}
