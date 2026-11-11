-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('DRAFT', 'PENDING_CONFIRMATION', 'CONFIRMED', 'FAILED', 'CANCEL_PENDING', 'CANCELLED', 'CANCELLED_BY_SUPPLIER', 'EXPIRED');

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'DRAFT',
    "snapshotId" TEXT,
    "propertyId" TEXT NOT NULL,
    "hotelName" TEXT NOT NULL,
    "hotelCity" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "roomName" TEXT NOT NULL,
    "rateId" TEXT NOT NULL,
    "bedGroupId" TEXT NOT NULL,
    "bedDescription" TEXT NOT NULL,
    "checkin" TEXT NOT NULL,
    "checkout" TEXT NOT NULL,
    "adults" INTEGER NOT NULL,
    "childAges" INTEGER[],
    "leadGivenName" TEXT NOT NULL,
    "leadFamilyName" TEXT NOT NULL,
    "leadEmail" TEXT NOT NULL,
    "leadPhone" TEXT NOT NULL,
    "guests" JSONB NOT NULL,
    "refundable" BOOLEAN NOT NULL,
    "totalMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "price" JSONB NOT NULL,
    "cancelPenalties" JSONB NOT NULL,
    "nonrefundableDateRanges" JSONB NOT NULL,
    "priceCheckToken" TEXT NOT NULL,
    "bookToken" TEXT,
    "priceCheckedAt" TIMESTAMP(3),
    "previousTotalMinor" INTEGER,
    "holdId" TEXT,
    "chargedMinor" INTEGER,
    "supplierItineraryId" TEXT,
    "supplierRoomId" TEXT,
    "supplierLinks" JSONB,
    "hotelConfirmationId" TEXT,
    "cancelChargeMinor" INTEGER,
    "refundMinor" INTEGER,
    "failureReason" TEXT,
    "reconcileAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastNotFoundAt" TIMESTAMP(3),
    "cancelRequestedAt" TIMESTAMP(3),
    "needsAttention" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingEvent" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "fromStatus" "BookingStatus",
    "toStatus" "BookingStatus" NOT NULL,
    "actorUserId" TEXT,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Booking_reference_key" ON "Booking"("reference");

-- CreateIndex
CREATE INDEX "Booking_agencyId_createdAt_idx" ON "Booking"("agencyId", "createdAt");

-- CreateIndex
CREATE INDEX "Booking_agencyId_status_checkin_idx" ON "Booking"("agencyId", "status", "checkin");

-- CreateIndex
CREATE INDEX "Booking_status_updatedAt_idx" ON "Booking"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "Booking_needsAttention_idx" ON "Booking"("needsAttention");

-- CreateIndex
CREATE INDEX "BookingEvent_bookingId_createdAt_idx" ON "BookingEvent"("bookingId", "createdAt");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingEvent" ADD CONSTRAINT "BookingEvent_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingEvent" ADD CONSTRAINT "BookingEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

