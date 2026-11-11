-- CreateEnum
CREATE TYPE "ContentSyncStatus" AS ENUM ('RUNNING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "Property" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "stateProvince" TEXT,
    "starRating" DECIMAL(2,1),
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "rank" INTEGER,
    "expediaCollect" BOOLEAN NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "catalogSeenRunId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentSyncRun" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" "ContentSyncStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "counts" JSONB,

    CONSTRAINT "ContentSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Property_active_expediaCollect_rank_idx" ON "Property"("active", "expediaCollect", "rank");

-- CreateIndex
CREATE INDEX "Property_countryCode_catalogSeenRunId_idx" ON "Property"("countryCode", "catalogSeenRunId");

-- CreateIndex
CREATE INDEX "ContentSyncRun_kind_status_startedAt_idx" ON "ContentSyncRun"("kind", "status", "startedAt");
