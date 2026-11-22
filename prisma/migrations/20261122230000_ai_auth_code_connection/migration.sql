-- AlterTable
ALTER TABLE "AiAuthCode" ADD COLUMN     "connectionId" TEXT;

-- AddForeignKey
ALTER TABLE "AiAuthCode" ADD CONSTRAINT "AiAuthCode_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "AiConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

