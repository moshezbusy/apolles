-- CreateTable
CREATE TABLE "AssistantAuthCode" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "codeChallenge" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantAuthCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistantConnection" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'search:read',
    "resource" TEXT NOT NULL,
    "authCodeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "AssistantConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AssistantAuthCode_codeHash_key" ON "AssistantAuthCode"("codeHash");

-- CreateIndex
CREATE INDEX "AssistantAuthCode_userId_idx" ON "AssistantAuthCode"("userId");

-- CreateIndex
CREATE INDEX "AssistantAuthCode_expiresAt_idx" ON "AssistantAuthCode"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AssistantConnection_tokenHash_key" ON "AssistantConnection"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "AssistantConnection_authCodeId_key" ON "AssistantConnection"("authCodeId");

-- CreateIndex
CREATE INDEX "AssistantConnection_agencyId_createdAt_idx" ON "AssistantConnection"("agencyId", "createdAt");

-- CreateIndex
CREATE INDEX "AssistantConnection_userId_idx" ON "AssistantConnection"("userId");

-- AddForeignKey
ALTER TABLE "AssistantAuthCode" ADD CONSTRAINT "AssistantAuthCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantConnection" ADD CONSTRAINT "AssistantConnection_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantConnection" ADD CONSTRAINT "AssistantConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
