-- AlterTable
ALTER TABLE "Facility" ADD COLUMN     "inviteCode" TEXT,
ADD COLUMN     "onboarded" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "reorderBoxes" INTEGER DEFAULT 5,
ADD COLUMN     "reorderStrips" INTEGER DEFAULT 10,
ADD COLUMN     "reorderTablets" INTEGER DEFAULT 50,
ADD COLUMN     "stripsPerBox" INTEGER,
ADD COLUMN     "tabletsPerStrip" INTEGER;

-- AlterTable
ALTER TABLE "SaleItem" ALTER COLUMN "costPrice" DROP DEFAULT;

-- CreateTable
CREATE TABLE "FacilityInvite" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'CASHIER',
    "createdBy" TEXT NOT NULL,
    "usesLeft" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacilityInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeleteRequest" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedBy" TEXT,
    "requestedById" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeleteRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FacilityInvite_token_key" ON "FacilityInvite"("token");

-- CreateIndex
CREATE UNIQUE INDEX "Facility_inviteCode_key" ON "Facility"("inviteCode");

-- AddForeignKey
ALTER TABLE "FacilityInvite" ADD CONSTRAINT "FacilityInvite_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeleteRequest" ADD CONSTRAINT "DeleteRequest_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

