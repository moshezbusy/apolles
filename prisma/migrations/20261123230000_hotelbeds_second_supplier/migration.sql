-- Hotelbeds as a second supplier through the supplier layer (owner decision 2026-11-23).
-- Additive only: two nullable columns that read "expedia" on every existing row, and the new
-- hotel mapping table. Nothing existing is changed or dropped.
-- CreateEnum
CREATE TYPE "SupplierHotelMapStatus" AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "supplier" TEXT DEFAULT 'expedia';

-- AlterTable
ALTER TABLE "SearchRate" ADD COLUMN     "supplier" TEXT DEFAULT 'expedia';

-- CreateTable
CREATE TABLE "SupplierHotelMap" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "supplier" TEXT NOT NULL DEFAULT 'hotelbeds',
    "layerHotelId" TEXT NOT NULL,
    "status" "SupplierHotelMapStatus" NOT NULL DEFAULT 'PROPOSED',
    "note" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierHotelMap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierHotelMap_supplier_status_propertyId_idx" ON "SupplierHotelMap"("supplier", "status", "propertyId");

-- CreateIndex
CREATE INDEX "SupplierHotelMap_createdAt_id_idx" ON "SupplierHotelMap"("createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierHotelMap_supplier_propertyId_key" ON "SupplierHotelMap"("supplier", "propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierHotelMap_supplier_layerHotelId_key" ON "SupplierHotelMap"("supplier", "layerHotelId");

-- AddForeignKey
ALTER TABLE "SupplierHotelMap" ADD CONSTRAINT "SupplierHotelMap_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierHotelMap" ADD CONSTRAINT "SupplierHotelMap_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierHotelMap" ADD CONSTRAINT "SupplierHotelMap_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

