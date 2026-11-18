-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "clientNote" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "selectedAt" TIMESTAMP(3),
ADD COLUMN     "sentAt" TIMESTAMP(3),
ADD COLUMN     "shareToken" TEXT,
ADD COLUMN     "viewCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "viewedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "QuoteStay" ADD COLUMN     "selectedRoomId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Quote_shareToken_key" ON "Quote"("shareToken");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteStay_selectedRoomId_key" ON "QuoteStay"("selectedRoomId");

-- AddForeignKey
ALTER TABLE "QuoteStay" ADD CONSTRAINT "QuoteStay_selectedRoomId_fkey" FOREIGN KEY ("selectedRoomId") REFERENCES "QuoteRoom"("id") ON DELETE SET NULL ON UPDATE CASCADE;

