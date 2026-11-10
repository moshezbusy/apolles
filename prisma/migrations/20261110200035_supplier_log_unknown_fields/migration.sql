-- AlterTable
ALTER TABLE "SupplierCallLog" ADD COLUMN     "unknownFields" TEXT[] DEFAULT ARRAY[]::TEXT[];
