-- AlterTable
ALTER TABLE "Agency" ADD COLUMN     "quoteValidDays" INTEGER NOT NULL DEFAULT 7;

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "sellMinor" INTEGER;

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "agencyNumber" INTEGER,
ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "editedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "validUntil" TIMESTAMP(3);

-- Backfill (new columns only; nothing that existed is changed).
-- The list order starts from what it was: the last change of each quote.
UPDATE "Quote" SET "editedAt" = "updatedAt";

-- Every agency's quotes get their own running number, in the order they were made.
UPDATE "Quote" q
SET "agencyNumber" = n.rn
FROM (
    SELECT "id", row_number() OVER (PARTITION BY "agencyId" ORDER BY "createdAt", "number") AS rn
    FROM "Quote"
) n
WHERE n."id" = q."id";

-- A quote already sent gets the default validity (7 days) from the day it was sent, so an old
-- link no longer takes selections at old prices. The agent can extend the offer.
UPDATE "Quote"
SET "validUntil" = date_trunc('day', "sentAt") + interval '7 days'
WHERE "sentAt" IS NOT NULL;

-- CreateIndex
CREATE INDEX "Quote_agencyId_editedAt_id_idx" ON "Quote"("agencyId", "editedAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "Quote_agencyId_status_editedAt_id_idx" ON "Quote"("agencyId", "status", "editedAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "Quote_agencyId_agencyNumber_idx" ON "Quote"("agencyId", "agencyNumber");
