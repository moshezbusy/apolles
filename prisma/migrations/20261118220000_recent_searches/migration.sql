-- CreateTable
CREATE TABLE "RecentSearch" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "destinationId" TEXT NOT NULL,
    "destinationName" TEXT NOT NULL,
    "checkin" TEXT NOT NULL,
    "checkout" TEXT NOT NULL,
    "adults" INTEGER NOT NULL,
    "childAges" INTEGER[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecentSearch_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "RecentSearch_userId_createdAt_idx" ON "RecentSearch"("userId", "createdAt" DESC);
-- AddForeignKey
ALTER TABLE "RecentSearch" ADD CONSTRAINT "RecentSearch_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "RecentSearch" ADD CONSTRAINT "RecentSearch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "RecentSearch_agencyId_idx" ON "RecentSearch"("agencyId");
