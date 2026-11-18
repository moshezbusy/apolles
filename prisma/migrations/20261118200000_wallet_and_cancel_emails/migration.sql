-- AlterTable
ALTER TABLE "Agency" ADD COLUMN     "lowBalanceAlerted" BOOLEAN NOT NULL DEFAULT false;
-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "freeCancelEndsAt" TIMESTAMP(3),
ADD COLUMN     "freeCancelReminderAt" TIMESTAMP(3);
-- CreateIndex
CREATE INDEX "Booking_status_freeCancelEndsAt_idx" ON "Booking"("status", "freeCancelEndsAt");
