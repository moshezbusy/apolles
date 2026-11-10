/*
  Warnings:

  - You are about to drop the column `logoUrl` on the `Agency` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Agency" DROP COLUMN "logoUrl";

-- CreateTable
CREATE TABLE "AgencyLogo" (
    "agencyId" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgencyLogo_pkey" PRIMARY KEY ("agencyId")
);

-- AddForeignKey
ALTER TABLE "AgencyLogo" ADD CONSTRAINT "AgencyLogo_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
