-- AI assistants, search only (plan 2026-11-22-mcp-search-connector). Additive only: three new
-- tables. Nothing existing is changed or dropped.
-- CreateTable
CREATE TABLE "AssistantClient" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "redirectUris" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistantAuthRequest" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "state" TEXT,
    "codeChallenge" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "userId" TEXT,
    "agencyId" TEXT,
    "codeHash" TEXT,
    "codeExpiresAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "connectionId" TEXT,
    "browserHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantAuthRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistantConnection" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "accessTokenHash" TEXT NOT NULL,
    "accessExpiresAt" TIMESTAMP(3) NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "previousRefreshHash" TEXT,
    "refreshExpiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,

    CONSTRAINT "AssistantConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssistantClient_createdAt_idx" ON "AssistantClient"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AssistantAuthRequest_codeHash_key" ON "AssistantAuthRequest"("codeHash");

-- CreateIndex
CREATE INDEX "AssistantAuthRequest_expiresAt_idx" ON "AssistantAuthRequest"("expiresAt");

-- CreateIndex
CREATE INDEX "AssistantAuthRequest_userId_idx" ON "AssistantAuthRequest"("userId");

-- CreateIndex
CREATE INDEX "AssistantAuthRequest_agencyId_idx" ON "AssistantAuthRequest"("agencyId");

-- CreateIndex
CREATE UNIQUE INDEX "AssistantConnection_accessTokenHash_key" ON "AssistantConnection"("accessTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "AssistantConnection_refreshTokenHash_key" ON "AssistantConnection"("refreshTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "AssistantConnection_previousRefreshHash_key" ON "AssistantConnection"("previousRefreshHash");

-- CreateIndex
CREATE INDEX "AssistantConnection_userId_revokedAt_idx" ON "AssistantConnection"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "AssistantConnection_agencyId_revokedAt_idx" ON "AssistantConnection"("agencyId", "revokedAt");

-- CreateIndex
CREATE INDEX "AssistantConnection_clientId_idx" ON "AssistantConnection"("clientId");

-- AddForeignKey
ALTER TABLE "AssistantAuthRequest" ADD CONSTRAINT "AssistantAuthRequest_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "AssistantClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantAuthRequest" ADD CONSTRAINT "AssistantAuthRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantConnection" ADD CONSTRAINT "AssistantConnection_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantConnection" ADD CONSTRAINT "AssistantConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantConnection" ADD CONSTRAINT "AssistantConnection_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "AssistantClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

