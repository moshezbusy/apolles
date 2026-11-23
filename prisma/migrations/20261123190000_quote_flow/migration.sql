-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "selectionUnseen" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "QuoteRoom" ADD COLUMN     "cancelWorse" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "needsRefresh" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "previousNetMinor" INTEGER,
ADD COLUMN     "pricedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "unavailable" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "QuoteStay" ADD COLUMN     "selectedByAgent" BOOLEAN NOT NULL DEFAULT false;

-- Backfill (new column only): a room's price is from the day it was added to the quote.
UPDATE "QuoteRoom" SET "pricedAt" = "createdAt";

-- CreateIndex
CREATE INDEX "Quote_agencyId_selectionUnseen_idx" ON "Quote"("agencyId", "selectionUnseen");
