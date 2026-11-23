-- CreateEnum
CREATE TYPE "SearchSource" AS ENUM ('WEB', 'AI');

-- AlterTable
ALTER TABLE "SearchSnapshot" ADD COLUMN     "source" "SearchSource" NOT NULL DEFAULT 'WEB';

-- CreateTable
CREATE TABLE "AiClient" (
    "id" TEXT NOT NULL,
    "clientIdUrl" TEXT,
    "name" TEXT NOT NULL,
    "redirectUris" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,

    CONSTRAINT "AiConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiAuthCode" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "codeChallenge" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "AiAuthCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiToken" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "accessHash" TEXT NOT NULL,
    "refreshHash" TEXT NOT NULL,
    "accessExpiresAt" TIMESTAMP(3) NOT NULL,
    "refreshExpiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "AiToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiConnectWindow" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "AiConnectWindow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiClient_clientIdUrl_key" ON "AiClient"("clientIdUrl");

-- CreateIndex
CREATE INDEX "AiConnection_agencyId_revokedAt_idx" ON "AiConnection"("agencyId", "revokedAt");

-- CreateIndex
CREATE INDEX "AiConnection_userId_idx" ON "AiConnection"("userId");

-- CreateIndex
CREATE INDEX "AiConnection_clientId_idx" ON "AiConnection"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "AiAuthCode_codeHash_key" ON "AiAuthCode"("codeHash");

-- CreateIndex
CREATE INDEX "AiAuthCode_userId_idx" ON "AiAuthCode"("userId");

-- CreateIndex
CREATE INDEX "AiAuthCode_expiresAt_idx" ON "AiAuthCode"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiToken_accessHash_key" ON "AiToken"("accessHash");

-- CreateIndex
CREATE UNIQUE INDEX "AiToken_refreshHash_key" ON "AiToken"("refreshHash");

-- CreateIndex
CREATE INDEX "AiToken_connectionId_idx" ON "AiToken"("connectionId");

-- CreateIndex
CREATE INDEX "AiConnectWindow_userId_idx" ON "AiConnectWindow"("userId");

-- CreateIndex
CREATE INDEX "SearchSnapshot_agencyId_source_createdAt_idx" ON "SearchSnapshot"("agencyId", "source", "createdAt");

-- AddForeignKey
ALTER TABLE "AiConnection" ADD CONSTRAINT "AiConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiConnection" ADD CONSTRAINT "AiConnection_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiConnection" ADD CONSTRAINT "AiConnection_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "AiClient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAuthCode" ADD CONSTRAINT "AiAuthCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAuthCode" ADD CONSTRAINT "AiAuthCode_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "AiClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiToken" ADD CONSTRAINT "AiToken_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "AiConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiConnectWindow" ADD CONSTRAINT "AiConnectWindow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
