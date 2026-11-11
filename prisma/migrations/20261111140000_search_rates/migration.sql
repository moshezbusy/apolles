-- CreateTable
CREATE TABLE "SearchRate" (
    "snapshotId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "rateIndex" INTEGER NOT NULL,
    "roomName" TEXT NOT NULL,
    "refundable" BOOLEAN NOT NULL,
    "totalMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "feesAtProperty" BOOLEAN NOT NULL,

    CONSTRAINT "SearchRate_pkey" PRIMARY KEY ("snapshotId","propertyId","rateIndex")
);

-- CreateIndex
CREATE INDEX "SearchRate_snapshotId_totalMinor_idx" ON "SearchRate"("snapshotId", "totalMinor");

-- AddForeignKey
ALTER TABLE "SearchRate" ADD CONSTRAINT "SearchRate_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "SearchSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
