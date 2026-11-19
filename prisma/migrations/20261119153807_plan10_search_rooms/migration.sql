-- Plan 10: a recent search keeps its rooms ([{ adults, childAges }] in room order). No backfill:
-- an older row (null) reads as one room from its adults and childAges.
ALTER TABLE "RecentSearch" ADD COLUMN     "rooms" JSONB;
