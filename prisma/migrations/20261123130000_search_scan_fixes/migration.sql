-- Scan fixes, search batch. All additive: nothing is dropped or rewritten.

-- A content sync shows it is alive; a run with no sign of life for 10 minutes is taken over by
-- the next try. No backfill: an older run (null) is judged by when it started.
ALTER TABLE "ContentSyncRun" ADD COLUMN     "heartbeatAt" TIMESTAMP(3);

-- When a rate's free cancellation ends, so the results filter and badge can compare it with the
-- clock. No backfill: rates of searches stored before this (kept 30 minutes) read as "none".
ALTER TABLE "SearchRate" ADD COLUMN     "freeCancelUntil" TIMESTAMP(3);

-- Stored searches are now counted and removed per user.
CREATE INDEX "SearchSnapshot_userId_createdAt_idx" ON "SearchSnapshot"("userId", "createdAt");
