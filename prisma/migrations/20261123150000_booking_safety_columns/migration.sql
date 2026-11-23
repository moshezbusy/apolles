-- AlterTable: all new columns are nullable; existing bookings keep working as they are.
ALTER TABLE "Booking" ADD COLUMN     "cancelRestoredAt" TIMESTAMP(3),
ADD COLUMN     "cancelRestoredChargeMinor" INTEGER,
ADD COLUMN     "supplierCheckedAt" TIMESTAMP(3),
ADD COLUMN     "agentIp" TEXT,
ADD COLUMN     "agentUserAgent" TEXT;

-- CreateIndex
CREATE INDEX "Booking_status_checkin_idx" ON "Booking"("status", "checkin");
