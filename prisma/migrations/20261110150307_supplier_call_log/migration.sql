-- CreateTable
CREATE TABLE "SupplierCallLog" (
    "id" TEXT NOT NULL,
    "supplier" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "status" INTEGER,
    "durationMs" INTEGER NOT NULL,
    "affiliateReferenceId" TEXT,
    "requestBody" JSONB,
    "responseBody" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierCallLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierCallLog_createdAt_idx" ON "SupplierCallLog"("createdAt");

-- CreateIndex
CREATE INDEX "SupplierCallLog_affiliateReferenceId_idx" ON "SupplierCallLog"("affiliateReferenceId");
