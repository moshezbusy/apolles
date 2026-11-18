-- AlterTable
ALTER TABLE "Agency" ADD COLUMN     "defaultMarkupType" "MarkupType" NOT NULL DEFAULT 'PERCENT',
ADD COLUMN     "defaultMarkupValue" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "defaultQuoteLanguage" "QuoteLanguage" NOT NULL DEFAULT 'EN',
ADD COLUMN     "defaultQuoteMessage" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "defaultShowCancellation" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "quoteAdvisorEmail" TEXT,
ADD COLUMN     "quoteAdvisorName" TEXT,
ADD COLUMN     "quoteBrandColor" TEXT,
ADD COLUMN     "quoteContactPhone" TEXT,
ADD COLUMN     "quoteDisplayName" TEXT;

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "quoteId" TEXT;

-- CreateIndex
CREATE INDEX "Booking_quoteId_idx" ON "Booking"("quoteId");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "quoteStayId" TEXT;

-- CreateIndex
CREATE INDEX "Booking_quoteStayId_status_idx" ON "Booking"("quoteStayId", "status");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_quoteStayId_fkey" FOREIGN KEY ("quoteStayId") REFERENCES "QuoteStay"("id") ON DELETE SET NULL ON UPDATE CASCADE;
