-- CreateEnum
CREATE TYPE "HoldAction" AS ENUM ('HOLD_ISSUED', 'RECALL_ISSUED', 'RELEASED');

-- CreateEnum
CREATE TYPE "CitizenReportReason" AS ENUM ('SUSPECTED_EXPIRED', 'SUSPECTED_COUNTERFEIT', 'PACKAGING_TAMPERED', 'ADVERSE_REACTION', 'SOLD_AFTER_RECALL', 'OTHER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AlertCode" ADD VALUE 'LOCATION_QUANTITY_BREACH';
ALTER TYPE "AlertCode" ADD VALUE 'STALLED_IN_PIPELINE';
ALTER TYPE "AlertCode" ADD VALUE 'UNAUTHORIZED_ROUTE';
ALTER TYPE "AlertCode" ADD VALUE 'RECALLED_SALE';
ALTER TYPE "AlertCode" ADD VALUE 'HELD_SALE';
ALTER TYPE "AlertCode" ADD VALUE 'CITIZEN_REPORT';

-- AlterEnum
ALTER TYPE "LedgerEvent" ADD VALUE 'TRANSFERRED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RegistryStatus" ADD VALUE 'HELD';
ALTER TYPE "RegistryStatus" ADD VALUE 'RECALLED';

-- CreateTable
CREATE TABLE "Transfer" (
    "id" TEXT NOT NULL,
    "fromOrgId" TEXT NOT NULL,
    "toOrgId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "authorized" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "serverTs" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthorizedRoute" (
    "id" TEXT NOT NULL,
    "fromOrgId" TEXT NOT NULL,
    "toOrgId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthorizedRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HoldRecallOrder" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "action" "HoldAction" NOT NULL,
    "reason" TEXT NOT NULL,
    "issuedByUserId" TEXT NOT NULL,
    "issuedByOrgId" TEXT NOT NULL,
    "releasesId" TEXT,
    "auditEventId" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HoldRecallOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsumerBill" (
    "id" TEXT NOT NULL,
    "billNo" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "pharmacyId" TEXT NOT NULL,
    "soldAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsumerBill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsumerBillLine" (
    "id" TEXT NOT NULL,
    "consumerBillId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "manufacturerName" TEXT NOT NULL,
    "manufacturerLicenseNo" TEXT NOT NULL,
    "batchNo" TEXT NOT NULL,
    "expiryDate" TIMESTAMP(3) NOT NULL,
    "qty" INTEGER NOT NULL,
    "posScanId" TEXT,

    CONSTRAINT "ConsumerBillLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CitizenReport" (
    "batchId" TEXT,
    "id" TEXT NOT NULL,
    "rawManufacturerRef" TEXT NOT NULL,
    "rawBatchNo" TEXT NOT NULL,
    "reason" "CitizenReportReason" NOT NULL,
    "description" TEXT,
    "pharmacyLicenseNo" TEXT,
    "location" TEXT,
    "auditEventId" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CitizenReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Transfer_batchId_idx" ON "Transfer"("batchId");

-- CreateIndex
CREATE INDEX "Transfer_fromOrgId_batchId_idx" ON "Transfer"("fromOrgId", "batchId");

-- CreateIndex
CREATE INDEX "Transfer_toOrgId_batchId_idx" ON "Transfer"("toOrgId", "batchId");

-- CreateIndex
CREATE INDEX "AuthorizedRoute_fromOrgId_idx" ON "AuthorizedRoute"("fromOrgId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthorizedRoute_fromOrgId_toOrgId_key" ON "AuthorizedRoute"("fromOrgId", "toOrgId");

-- CreateIndex
CREATE UNIQUE INDEX "HoldRecallOrder_auditEventId_key" ON "HoldRecallOrder"("auditEventId");

-- CreateIndex
CREATE INDEX "HoldRecallOrder_batchId_createdAt_idx" ON "HoldRecallOrder"("batchId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConsumerBill_billNo_key" ON "ConsumerBill"("billNo");

-- CreateIndex
CREATE UNIQUE INDEX "ConsumerBill_token_key" ON "ConsumerBill"("token");

-- CreateIndex
CREATE INDEX "ConsumerBill_pharmacyId_soldAt_idx" ON "ConsumerBill"("pharmacyId", "soldAt");

-- CreateIndex
CREATE INDEX "ConsumerBillLine_consumerBillId_idx" ON "ConsumerBillLine"("consumerBillId");

-- CreateIndex
CREATE INDEX "ConsumerBillLine_batchId_idx" ON "ConsumerBillLine"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "CitizenReport_auditEventId_key" ON "CitizenReport"("auditEventId");

-- CreateIndex
CREATE INDEX "CitizenReport_createdAt_idx" ON "CitizenReport"("createdAt");

-- CreateIndex
CREATE INDEX "CitizenReport_batchId_idx" ON "CitizenReport"("batchId");

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_fromOrgId_fkey" FOREIGN KEY ("fromOrgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_toOrgId_fkey" FOREIGN KEY ("toOrgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HoldRecallOrder" ADD CONSTRAINT "HoldRecallOrder_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HoldRecallOrder" ADD CONSTRAINT "HoldRecallOrder_auditEventId_fkey" FOREIGN KEY ("auditEventId") REFERENCES "AuditEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumerBill" ADD CONSTRAINT "ConsumerBill_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumerBillLine" ADD CONSTRAINT "ConsumerBillLine_consumerBillId_fkey" FOREIGN KEY ("consumerBillId") REFERENCES "ConsumerBill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumerBillLine" ADD CONSTRAINT "ConsumerBillLine_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CitizenReport" ADD CONSTRAINT "CitizenReport_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CitizenReport" ADD CONSTRAINT "CitizenReport_auditEventId_fkey" FOREIGN KEY ("auditEventId") REFERENCES "AuditEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
