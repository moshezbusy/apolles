// Every kind of background job. Each one has a handler in handlers.ts.
export const JOB_KINDS = ["content.regions", "content.catalog", "content.inactive", "search.cleanup", "booking.reconcile"] as const;
export type JobKind = (typeof JOB_KINDS)[number];
