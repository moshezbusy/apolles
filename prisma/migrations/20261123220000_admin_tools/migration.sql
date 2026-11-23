-- Admin tools (scan fix wave 2): 2FA recovery codes, change requests, and indexes for the admin
-- lists. New tables and indexes only: nothing existing is changed.

-- CreateEnum
CREATE TYPE "ChangeRequestStatus" AS ENUM ('OPEN', 'DONE');

-- CreateTable
CREATE TABLE "TotpRecoveryCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TotpRecoveryCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangeRequest" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" "ChangeRequestStatus" NOT NULL DEFAULT 'OPEN',
    "adminNote" TEXT NOT NULL DEFAULT '',
    "doneAt" TIMESTAMP(3),
    "doneById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TotpRecoveryCode_codeHash_key" ON "TotpRecoveryCode"("codeHash");

-- CreateIndex
CREATE INDEX "TotpRecoveryCode_userId_usedAt_idx" ON "TotpRecoveryCode"("userId", "usedAt");

-- CreateIndex
CREATE INDEX "ChangeRequest_status_createdAt_id_idx" ON "ChangeRequest"("status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "ChangeRequest_createdAt_id_idx" ON "ChangeRequest"("createdAt", "id");

-- CreateIndex
CREATE INDEX "ChangeRequest_bookingId_createdAt_idx" ON "ChangeRequest"("bookingId", "createdAt");

-- CreateIndex
CREATE INDEX "ChangeRequest_agencyId_createdAt_idx" ON "ChangeRequest"("agencyId", "createdAt");

-- CreateIndex
CREATE INDEX "Agency_status_createdAt_id_idx" ON "Agency"("status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_id_idx" ON "AuditLog"("createdAt", "id");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_id_idx" ON "AuditLog"("action", "createdAt", "id");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_createdAt_id_idx" ON "AuditLog"("actorUserId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Booking_createdAt_id_idx" ON "Booking"("createdAt", "id");

-- AddForeignKey
ALTER TABLE "TotpRecoveryCode" ADD CONSTRAINT "TotpRecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_doneById_fkey" FOREIGN KEY ("doneById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

