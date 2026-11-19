-- CreateEnum
CREATE TYPE "BookingRoomStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- CreateTable
CREATE TABLE "BookingRoom" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "adults" INTEGER NOT NULL,
    "childAges" INTEGER[],
    "guests" JSONB NOT NULL,
    "givenName" TEXT NOT NULL,
    "familyName" TEXT NOT NULL,
    "totalMinor" INTEGER NOT NULL,
    "price" JSONB NOT NULL,
    "supplierRoomId" TEXT,
    "hotelConfirmationId" TEXT,
    "cancelLink" TEXT,
    "status" "BookingRoomStatus" NOT NULL DEFAULT 'ACTIVE',
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "BookingRoom_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BookingRoom_bookingId_index_key" ON "BookingRoom"("bookingId", "index");

-- AddForeignKey
ALTER TABLE "BookingRoom" ADD CONSTRAINT "BookingRoom_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: every booking made before plan 10 is one room, built from the booking's own fields
-- (its guests, its whole price, its supplier room, hotel confirmation and cancel link). A
-- cancelled booking's room is cancelled with it; every other room is active. Running it again,
-- or on a booking that already has its room, adds nothing.
INSERT INTO "BookingRoom" ("id", "bookingId", "index", "adults", "childAges", "guests", "givenName", "familyName", "totalMinor", "price", "supplierRoomId", "hotelConfirmationId", "cancelLink", "status", "cancelledAt")
SELECT
    b."id" || '-room0',
    b."id",
    0,
    b."adults",
    b."childAges",
    b."guests",
    b."leadGivenName",
    b."leadFamilyName",
    b."totalMinor",
    b."price",
    b."supplierRoomId",
    b."hotelConfirmationId",
    b."supplierLinks"->>'cancel',
    CASE WHEN b."status" IN ('CANCELLED', 'CANCELLED_BY_SUPPLIER') THEN 'CANCELLED'::"BookingRoomStatus" ELSE 'ACTIVE'::"BookingRoomStatus" END,
    CASE WHEN b."status" IN ('CANCELLED', 'CANCELLED_BY_SUPPLIER') THEN b."cancelledAt" ELSE NULL END
FROM "Booking" b
ON CONFLICT ("bookingId", "index") DO NOTHING;
