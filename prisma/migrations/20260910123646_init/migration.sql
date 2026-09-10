-- CreateEnum
CREATE TYPE "OrgType" AS ENUM ('RETAILER', 'DISTRIBUTOR', 'MANUFACTURER', 'FACILITY', 'REGULATOR');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('RETAILER', 'DISTRIBUTOR', 'MANUFACTURER', 'FACILITY', 'REGULATOR');

-- CreateEnum
CREATE TYPE "RegistryStatus" AS ENUM ('CLEAN', 'IN_RETURN_PIPELINE', 'DESTROYED');

-- CreateEnum
CREATE TYPE "InventoryStatus" AS ENUM ('ACTIVE', 'QUARANTINED', 'RETURNED');

-- CreateEnum
CREATE TYPE "ExpiryState" AS ENUM ('NORMAL', 'EXPIRY_WARNING', 'RETURN_DUE');

-- CreateEnum
CREATE TYPE "ReturnState" AS ENUM ('RETURN_DUE', 'INITIATED', 'PICKUP_ASSIGNED', 'DISTRIBUTOR_RECEIVED', 'MANUFACTURER_RECEIVED', 'DISPOSAL_SCHEDULED', 'FACILITY_RECEIVED', 'CERTIFIED_DESTROYED');

-- CreateEnum
CREATE TYPE "LedgerEvent" AS ENUM ('ISSUED', 'SUPPLIED', 'BILLED', 'RETURN_INITIATED', 'RECEIVED', 'LEAKED', 'DESTROYED');

-- CreateEnum
CREATE TYPE "ScanContext" AS ENUM ('SALE', 'RETURN_INTAKE', 'VERIFY');

-- CreateEnum
CREATE TYPE "ScanVerdict" AS ENUM ('ALLOW', 'BLOCK');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "LeakageStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'WRITTEN_OFF');

-- CreateEnum
CREATE TYPE "AlertCode" AS ENUM ('UNKNOWN_BATCH', 'RESURRECTED_BATCH', 'EXPIRED_SALE', 'IN_PIPELINE_SALE', 'QUANTITY_BREACH', 'DOUBLE_RETURN', 'LEAKAGE', 'WEIGHT_MISMATCH', 'BACKDATED_INVOICE', 'CERTIFICATE_OVER_ALLOCATION');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "OrgType" NOT NULL,
    "licenseNo" TEXT NOT NULL,
    "stateCode" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "mappedDistributorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "form" TEXT NOT NULL,
    "manufacturerId" TEXT NOT NULL,
    "unitWeightG" DOUBLE PRECISION NOT NULL DEFAULT 0.75,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Batch" (
    "id" TEXT NOT NULL,
    "manufacturerId" TEXT NOT NULL,
    "batchNo" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "issuedQty" INTEGER NOT NULL,
    "mfgDate" TIMESTAMP(3) NOT NULL,
    "expiryDate" TIMESTAMP(3) NOT NULL,
    "registryStatus" "RegistryStatus" NOT NULL DEFAULT 'CLEAN',
    "destroyedAt" TIMESTAMP(3),

    CONSTRAINT "Batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inventory" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "status" "InventoryStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "Inventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BatchLedger" (
    "id" BIGSERIAL NOT NULL,
    "batchId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "eventType" "LedgerEvent" NOT NULL,
    "qtyDelta" INTEGER NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "serverTs" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BatchLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnRequest" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "retailerId" TEXT NOT NULL,
    "distributorId" TEXT NOT NULL,
    "manufacturerId" TEXT NOT NULL,
    "state" "ReturnState" NOT NULL DEFAULT 'RETURN_DUE',
    "dueBy" TIMESTAMP(3) NOT NULL,
    "declaredQty" INTEGER,
    "condition" TEXT,
    "photoUrl" TEXT,
    "initiatedAt" TIMESTAMP(3),
    "pickupAt" TIMESTAMP(3),
    "distReceivedQty" INTEGER,
    "distWeightG" DOUBLE PRECISION,
    "distPhotoUrl" TEXT,
    "distReceivedAt" TIMESTAMP(3),
    "mfgReceivedQty" INTEGER,
    "mfgReceivedAt" TIMESTAMP(3),
    "confirmedQty" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReturnRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeakageRecord" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "fromOrgId" TEXT NOT NULL,
    "toOrgId" TEXT NOT NULL,
    "declaredQty" INTEGER NOT NULL,
    "receivedQty" INTEGER NOT NULL,
    "leakedQty" INTEGER NOT NULL,
    "status" "LeakageStatus" NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeakageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisposalRequest" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "manufacturerId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "scheduledDate" TIMESTAMP(3) NOT NULL,
    "facilityReceivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisposalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DestructionCertificate" (
    "id" TEXT NOT NULL,
    "certNo" TEXT NOT NULL,
    "disposalRequestId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DestructionCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosScan" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "rawManufacturerRef" TEXT NOT NULL,
    "rawBatchNo" TEXT NOT NULL,
    "batchId" TEXT,
    "qty" INTEGER NOT NULL,
    "context" "ScanContext" NOT NULL,
    "claimedInvoiceDate" TIMESTAMP(3),
    "verdict" "ScanVerdict" NOT NULL,
    "alertCode" "AlertCode",
    "serverTs" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosScan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "code" "AlertCode" NOT NULL,
    "severity" "Severity" NOT NULL,
    "batchId" TEXT,
    "orgId" TEXT,
    "payload" JSONB NOT NULL,
    "acknowledgedById" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" BIGSERIAL NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorOrgId" TEXT,
    "payload" JSONB NOT NULL,
    "prevHash" TEXT,
    "hash" TEXT NOT NULL,
    "serverTs" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "key" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseStatus" INTEGER NOT NULL,
    "responseBody" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_licenseNo_key" ON "Organization"("licenseNo");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Batch_expiryDate_idx" ON "Batch"("expiryDate");

-- CreateIndex
CREATE UNIQUE INDEX "Batch_manufacturerId_batchNo_key" ON "Batch"("manufacturerId", "batchNo");

-- CreateIndex
CREATE UNIQUE INDEX "Inventory_orgId_batchId_key" ON "Inventory"("orgId", "batchId");

-- CreateIndex
CREATE INDEX "BatchLedger_batchId_eventType_idx" ON "BatchLedger"("batchId", "eventType");

-- CreateIndex
CREATE INDEX "BatchLedger_orgId_batchId_eventType_idx" ON "BatchLedger"("orgId", "batchId", "eventType");

-- CreateIndex
CREATE INDEX "ReturnRequest_state_idx" ON "ReturnRequest"("state");

-- CreateIndex
CREATE INDEX "ReturnRequest_dueBy_idx" ON "ReturnRequest"("dueBy");

-- CreateIndex
CREATE INDEX "LeakageRecord_status_idx" ON "LeakageRecord"("status");

-- CreateIndex
CREATE INDEX "LeakageRecord_fromOrgId_idx" ON "LeakageRecord"("fromOrgId");

-- CreateIndex
CREATE UNIQUE INDEX "DestructionCertificate_certNo_key" ON "DestructionCertificate"("certNo");

-- CreateIndex
CREATE INDEX "Alert_severity_createdAt_idx" ON "Alert"("severity", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_mappedDistributorId_fkey" FOREIGN KEY ("mappedDistributorId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_manufacturerId_fkey" FOREIGN KEY ("manufacturerId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_manufacturerId_fkey" FOREIGN KEY ("manufacturerId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchLedger" ADD CONSTRAINT "BatchLedger_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchLedger" ADD CONSTRAINT "BatchLedger_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnRequest" ADD CONSTRAINT "ReturnRequest_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnRequest" ADD CONSTRAINT "ReturnRequest_retailerId_fkey" FOREIGN KEY ("retailerId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnRequest" ADD CONSTRAINT "ReturnRequest_distributorId_fkey" FOREIGN KEY ("distributorId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnRequest" ADD CONSTRAINT "ReturnRequest_manufacturerId_fkey" FOREIGN KEY ("manufacturerId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeakageRecord" ADD CONSTRAINT "LeakageRecord_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "ReturnRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisposalRequest" ADD CONSTRAINT "DisposalRequest_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "ReturnRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DestructionCertificate" ADD CONSTRAINT "DestructionCertificate_disposalRequestId_fkey" FOREIGN KEY ("disposalRequestId") REFERENCES "DisposalRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DestructionCertificate" ADD CONSTRAINT "DestructionCertificate_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
