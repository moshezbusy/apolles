-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "codeAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "codeExpiresAt" TIMESTAMP(3),
ADD COLUMN     "codeHash" TEXT,
ADD COLUMN     "codeSends" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3);
-- CreateTable
CREATE TABLE "TrustedDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrustedDevice_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "TrustedDevice_tokenHash_key" ON "TrustedDevice"("tokenHash");
-- CreateIndex
CREATE INDEX "TrustedDevice_userId_idx" ON "TrustedDevice"("userId");
-- AddForeignKey
ALTER TABLE "TrustedDevice" ADD CONSTRAINT "TrustedDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Sessions that exist when this ships count as verified: nobody is cut off.
UPDATE "Session" SET "emailVerifiedAt" = "createdAt" WHERE "emailVerifiedAt" IS NULL;
