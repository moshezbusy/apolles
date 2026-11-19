-- AlterTable
ALTER TABLE "BookingRoom" ADD COLUMN     "cancelRequestedAt" TIMESTAMP(3);

-- Backfill: a booking already cancelling when this ships had its (one) room's cancel sent by the
-- code before plan 10, so that room counts as sent: the checks wait for the supplier and never
-- send it a second time.
UPDATE "BookingRoom" r
SET "cancelRequestedAt" = COALESCE(b."cancelRequestedAt", now())
FROM "Booking" b
WHERE r."bookingId" = b."id" AND b."status" = 'CANCEL_PENDING' AND r."status" = 'ACTIVE' AND r."cancelRequestedAt" IS NULL;
