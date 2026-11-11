-- CreateTable
CREATE TABLE "Destination" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameFull" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "propertyCount" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "seenRunId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Destination_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DestinationProperty" (
    "destinationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,

    CONSTRAINT "DestinationProperty_pkey" PRIMARY KEY ("destinationId","propertyId")
);

-- CreateIndex
CREATE INDEX "Destination_countryCode_seenRunId_idx" ON "Destination"("countryCode", "seenRunId");

-- CreateIndex
CREATE INDEX "DestinationProperty_propertyId_idx" ON "DestinationProperty"("propertyId");

-- Prefix search on destination names (suggestDestinations), active rows only.
CREATE INDEX "destination_name_prefix" ON "Destination" (lower("name") text_pattern_ops) WHERE "active";
