-- CreateTable
CREATE TABLE "PropertyContentCache" (
    "propertyId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PropertyContentCache_pkey" PRIMARY KEY ("propertyId")
);

-- CreateIndex
CREATE INDEX "PropertyContentCache_fetchedAt_idx" ON "PropertyContentCache"("fetchedAt");
