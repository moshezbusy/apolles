-- CreateTable
CREATE TABLE "SearchSnapshot" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "query" JSONB NOT NULL,
    "candidateIds" TEXT[],
    "nextIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SearchSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchHotel" (
    "snapshotId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "starRating" DECIMAL(2,1),
    "minTotalMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "refundableAvailable" BOOLEAN NOT NULL,
    "offers" JSONB NOT NULL,

    CONSTRAINT "SearchHotel_pkey" PRIMARY KEY ("snapshotId","propertyId")
);

-- CreateIndex
CREATE INDEX "SearchSnapshot_agencyId_createdAt_idx" ON "SearchSnapshot"("agencyId", "createdAt");

-- CreateIndex
CREATE INDEX "SearchSnapshot_expiresAt_idx" ON "SearchSnapshot"("expiresAt");

-- CreateIndex
CREATE INDEX "SearchHotel_snapshotId_position_idx" ON "SearchHotel"("snapshotId", "position");

-- CreateIndex
CREATE INDEX "SearchHotel_snapshotId_minTotalMinor_idx" ON "SearchHotel"("snapshotId", "minTotalMinor");

-- AddForeignKey
ALTER TABLE "SearchHotel" ADD CONSTRAINT "SearchHotel_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "SearchSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
