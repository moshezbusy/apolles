-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "totpVerifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "totpConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "totpLastUsedStep" INTEGER;
