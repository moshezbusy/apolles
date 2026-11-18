-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'SENT', 'VIEWED', 'SELECTED', 'BOOKED');

-- CreateEnum
CREATE TYPE "QuoteLanguage" AS ENUM ('EN', 'HE');

-- CreateEnum
CREATE TYPE "MarkupType" AS ENUM ('PERCENT', 'FIXED');

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "agencyId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "clientId" TEXT,
    "title" TEXT NOT NULL DEFAULT '',
    "language" "QuoteLanguage" NOT NULL DEFAULT 'EN',
    "message" TEXT NOT NULL DEFAULT '',
    "showCancellation" BOOLEAN NOT NULL DEFAULT true,
    "markupType" "MarkupType" NOT NULL DEFAULT 'PERCENT',
    "markupValue" INTEGER NOT NULL DEFAULT 0,
    "adults" INTEGER NOT NULL DEFAULT 2,
    "childAges" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteStay" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "destinationId" TEXT NOT NULL,
    "destinationName" TEXT NOT NULL,
    "checkin" TEXT NOT NULL,
    "checkout" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "QuoteStay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteHotel" (
    "id" TEXT NOT NULL,
    "stayId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "starRating" DECIMAL(2,1),
    "agencyPick" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL,

    CONSTRAINT "QuoteHotel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteRoom" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "rateId" TEXT NOT NULL,
    "bedGroupId" TEXT NOT NULL,
    "roomName" TEXT NOT NULL,
    "bedDescription" TEXT NOT NULL,
    "refundable" BOOLEAN NOT NULL,
    "freeCancelUntil" TEXT,
    "clientCancelUntil" TEXT,
    "netMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "price" JSONB NOT NULL,
    "sellMinor" INTEGER,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteRoom_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Quote_number_key" ON "Quote"("number");

-- CreateIndex
CREATE INDEX "Quote_agencyId_updatedAt_id_idx" ON "Quote"("agencyId", "updatedAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "Quote_agencyId_status_updatedAt_id_idx" ON "Quote"("agencyId", "status", "updatedAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "Quote_clientId_idx" ON "Quote"("clientId");

-- CreateIndex
CREATE INDEX "QuoteStay_quoteId_position_idx" ON "QuoteStay"("quoteId", "position");

-- CreateIndex
CREATE INDEX "QuoteHotel_stayId_position_idx" ON "QuoteHotel"("stayId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteHotel_stayId_propertyId_key" ON "QuoteHotel"("stayId", "propertyId");

-- CreateIndex
CREATE INDEX "QuoteRoom_hotelId_position_idx" ON "QuoteRoom"("hotelId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteRoom_hotelId_rateId_bedGroupId_key" ON "QuoteRoom"("hotelId", "rateId", "bedGroupId");

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteStay" ADD CONSTRAINT "QuoteStay_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteHotel" ADD CONSTRAINT "QuoteHotel_stayId_fkey" FOREIGN KEY ("stayId") REFERENCES "QuoteStay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteRoom" ADD CONSTRAINT "QuoteRoom_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "QuoteHotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
