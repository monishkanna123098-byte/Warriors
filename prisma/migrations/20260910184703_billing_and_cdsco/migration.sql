-- CreateEnum
CREATE TYPE "BillStatus" AS ENUM ('OK', 'EXPIRED');

-- CreateEnum
CREATE TYPE "LicensedEntityType" AS ENUM ('RETAILER', 'WHOLESALER');

-- DropEnum
DROP TYPE "ExpiryState";

-- CreateTable
CREATE TABLE "Bill" (
    "id" TEXT NOT NULL,
    "returnRequestId" TEXT,
    "batchId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "BillStatus" NOT NULL,
    "anomalyCodes" TEXT[],
    "anomalyNote" TEXT,
    "auditEventId" BIGINT NOT NULL,

    CONSTRAINT "Bill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NsqAlert" (
    "id" TEXT NOT NULL,
    "medicineName" TEXT NOT NULL,
    "batchNo" TEXT NOT NULL,
    "dateFlagged" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'CDSCO',
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NsqAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LicensedEntity" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "licenseNo" TEXT NOT NULL,
    "type" "LicensedEntityType" NOT NULL,
    "state" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LicensedEntity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Bill_auditEventId_key" ON "Bill"("auditEventId");

-- CreateIndex
CREATE INDEX "Bill_batchId_generatedAt_idx" ON "Bill"("batchId", "generatedAt");

-- CreateIndex
CREATE INDEX "Bill_status_generatedAt_idx" ON "Bill"("status", "generatedAt");

-- CreateIndex
CREATE INDEX "NsqAlert_batchNo_idx" ON "NsqAlert"("batchNo");

-- CreateIndex
CREATE UNIQUE INDEX "NsqAlert_medicineName_batchNo_key" ON "NsqAlert"("medicineName", "batchNo");

-- CreateIndex
CREATE UNIQUE INDEX "LicensedEntity_licenseNo_key" ON "LicensedEntity"("licenseNo");

-- CreateIndex
CREATE INDEX "LicensedEntity_status_idx" ON "LicensedEntity"("status");

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_auditEventId_fkey" FOREIGN KEY ("auditEventId") REFERENCES "AuditEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
