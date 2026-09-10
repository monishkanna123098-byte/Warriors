// docs/SPEC.md §8 — seed data that must support every act of the demo.
// Every quantity here is load-bearing for an acceptance item in §9; read the
// trailing comments before changing one.

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { raiseDueReturns } from "../src/lib/lifecycle";

const prisma = new PrismaClient();

const PASSWORD = "demo1234";
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

async function main() {
  console.log("Resetting…");
  // Order matters: children before parents.
  await prisma.$transaction([
    prisma.destructionCertificate.deleteMany(),
    prisma.disposalRequest.deleteMany(),
    prisma.leakageRecord.deleteMany(),
    prisma.returnRequest.deleteMany(),
    prisma.batchLedger.deleteMany(),
    prisma.inventory.deleteMany(),
    prisma.alert.deleteMany(),
    prisma.posScan.deleteMany(),
    prisma.auditEvent.deleteMany(),
    prisma.idempotencyKey.deleteMany(),
    prisma.user.deleteMany(),
    prisma.batch.deleteMany(),
    prisma.product.deleteMany(),
  ]);
  await prisma.organization.updateMany({ data: { mappedDistributorId: null } });
  await prisma.organization.deleteMany();

  const org = (
    name: string,
    type: "RETAILER" | "DISTRIBUTOR" | "MANUFACTURER" | "FACILITY" | "REGULATOR",
    licenseNo: string,
    district: string,
    mappedDistributorId?: string,
  ) =>
    prisma.organization.create({
      data: { name, type, licenseNo, stateCode: "TN", district, mappedDistributorId },
    });

  const mfg1 = await org("Aurex Pharma", "MANUFACTURER", "MFG/TN/001", "Sriperumbudur");
  const mfg2 = await org("Kelvin Labs", "MANUFACTURER", "MFG/TN/002", "Hosur");
  const dist1 = await org("Chennai Meds", "DISTRIBUTOR", "DL/TN/210", "Chennai");
  const retA = await org("Anna Nagar Medicals", "RETAILER", "DL/TN/4401", "Anna Nagar", dist1.id);
  const retB = await org("Guindy Pharmacy", "RETAILER", "DL/TN/4402", "Guindy", dist1.id);
  const retC = await org("Velachery Chemist", "RETAILER", "DL/TN/4403", "Velachery", dist1.id);
  const fac1 = await org("TN Biomedical", "FACILITY", "BMW/TN/07", "Gummidipoondi");
  const reg1 = await org("TN Drugs Control", "REGULATOR", "REG/TN", "Chennai");

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const users: [string, typeof mfg1, "RETAILER" | "DISTRIBUTOR" | "MANUFACTURER" | "FACILITY" | "REGULATOR"][] = [
    ["mfg1@aurex.example", mfg1, "MANUFACTURER"],
    ["mfg2@kelvin.example", mfg2, "MANUFACTURER"],
    ["dist1@chennaimeds.example", dist1, "DISTRIBUTOR"],
    ["reta@annanagar.example", retA, "RETAILER"],
    ["retb@guindy.example", retB, "RETAILER"],
    ["retc@velachery.example", retC, "RETAILER"],
    ["fac1@tnbiomedical.example", fac1, "FACILITY"],
    ["reg1@tndrugscontrol.example", reg1, "REGULATOR"],
  ];
  for (const [email, o, role] of users) {
    await prisma.user.create({
      data: { email, passwordHash, role, organizationId: o.id },
    });
  }

  // Same drug, different maker — the pair that makes A10 meaningful.
  const p1 = await prisma.product.create({
    data: { name: "Amoxicillin 500mg", form: "Capsule", manufacturerId: mfg1.id, unitWeightG: 0.75 },
  });
  const p2 = await prisma.product.create({
    data: { name: "Amoxicillin 500mg", form: "Capsule", manufacturerId: mfg2.id, unitWeightG: 0.75 },
  });

  const mkBatch = (
    manufacturerId: string,
    batchNo: string,
    productId: string,
    issuedQty: number,
    expiry: string,
  ) =>
    prisma.batch.create({
      data: {
        manufacturerId,
        batchNo,
        productId,
        issuedQty,
        mfgDate: new Date(new Date(expiry).getTime() - 2 * YEAR_MS),
        expiryDate: new Date(expiry),
      },
    });

  // Expiry dates are fixed calendar dates, not offsets from today: the demo
  // script and the acceptance checklist both name them.
  const b1001 = await mkBatch(mfg1.id, "B-1001", p1.id, 500, "2026-08-15T00:00:00Z"); // past — main thread
  const b2002 = await mkBatch(mfg1.id, "B-2002", p1.id, 300, "2026-08-01T00:00:00Z"); // past — A1, never returned
  const b3003 = await mkBatch(mfg1.id, "B-3003", p1.id, 200, "2027-06-30T00:00:00Z"); // future — A12 clone target
  const k1001 = await mkBatch(mfg2.id, "B-1001", p2.id, 400, "2027-03-31T00:00:00Z"); // future — A10 collision proof

  const inv = (orgId: string, batchId: string, qty: number) =>
    prisma.inventory.create({ data: { orgId, batchId, qty } });

  await inv(retA.id, b1001.id, 100);
  await inv(retB.id, b1001.id, 40);
  await inv(retC.id, b2002.id, 60);
  await inv(retC.id, b3003.id, 50);

  const led = (
    batchId: string,
    orgId: string,
    eventType: "ISSUED" | "SUPPLIED" | "BILLED",
    qtyDelta: number,
  ) => prisma.batchLedger.create({ data: { batchId, orgId, eventType, qtyDelta, refType: "seed" } });

  for (const b of [b1001, b2002, b3003, k1001]) {
    await led(b.id, b.manufacturerId, "ISSUED", b.issuedQty);
  }

  await led(b1001.id, retA.id, "SUPPLIED", 100);
  await led(b1001.id, retB.id, "SUPPLIED", 40);
  await led(b2002.id, retC.id, "SUPPLIED", 60);
  await led(b3003.id, retC.id, "SUPPLIED", 50);

  // 195 of 200 issued already billed — leaves 5 units of headroom, so a scan of
  // 10 breaches I1. This is acceptance A12 and nothing else; do not round it.
  await led(b3003.id, retC.id, "BILLED", 195);

  // The system raises RETURN_DUE; it never fabricates a return (SPEC §4).
  // Seeding these keeps the demo's opening state deterministic — INITIATED still
  // requires a retailer action with evidence.
  const raised = await raiseDueReturns(prisma, new Date());

  console.log("Seeded.");
  console.table({
    orgs: 8,
    users: users.length,
    products: 2,
    batches: 4,
    returnsRaised: raised,
    login: `any email above / ${PASSWORD}`,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
