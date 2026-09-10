// docs/SPEC.md §8 — seed data that must support every act of the demo.
// Every quantity here is load-bearing for an acceptance item in §9; read the
// trailing comments before changing one.

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { execFileSync } from "node:child_process";
import { issueHoldOrRecall, raiseDueReturns, transition } from "../src/lib/lifecycle";
import { executeTransfer } from "../src/lib/transfer";
import { appendAudit } from "../src/lib/audit";
import { buildBillPayload } from "../src/lib/billing";
import { AlertCode, ReturnState } from "../src/lib/types";

const prisma = new PrismaClient();

const PASSWORD = "demo1234";
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

async function main() {
  console.log("Resetting…");
  // Order matters: children before parents.
  await prisma.$transaction([
    prisma.consumerBillLine.deleteMany(),
    prisma.consumerBill.deleteMany(),
    prisma.citizenReport.deleteMany(),
    prisma.holdRecallOrder.deleteMany(),
    prisma.transfer.deleteMany(),
    prisma.authorizedRoute.deleteMany(),
    prisma.bill.deleteMany(),
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
    prisma.nsqAlert.deleteMany(),
    prisma.licensedEntity.deleteMany(),
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

  // Additional catalogue so the dashboards are not one-product wide.
  const p3 = await prisma.product.create({
    data: { name: "Paracetamol 650mg", form: "Tablet", manufacturerId: mfg1.id, unitWeightG: 0.9 },
  });
  const p4 = await prisma.product.create({
    data: { name: "Metformin 500mg", form: "Tablet", manufacturerId: mfg2.id, unitWeightG: 0.62 },
  });
  const p5 = await prisma.product.create({
    data: { name: "Cetirizine 10mg", form: "Tablet", manufacturerId: mfg1.id, unitWeightG: 0.18 },
  });

  const inv = (orgId: string, batchId: string, qty: number) =>
    prisma.inventory.create({ data: { orgId, batchId, qty } });

  // Extra batches spanning every expiry state, so the inventory chips and the
  // manufacturer health bars all have something to show.
  const p7781 = await mkBatch(mfg1.id, "P-7781", p3.id, 600, "2027-01-20T00:00:00Z"); // NSQ-flagged, in date
  const c9004 = await mkBatch(mfg1.id, "C-9004", p5.id, 250, "2026-10-05T00:00:00Z"); // EXPIRY_WARNING
  const m3320 = await mkBatch(mfg2.id, "M-3320", p4.id, 350, "2026-07-10T00:00:00Z"); // past — second return thread
  const p9100 = await mkBatch(mfg1.id, "P-9100", p3.id, 400, "2028-02-28T00:00:00Z"); // healthy, far future

  await inv(retA.id, b1001.id, 100);
  await inv(retB.id, b1001.id, 40);
  await inv(retC.id, b2002.id, 60);
  await inv(retC.id, b3003.id, 50);
  await inv(retA.id, p7781.id, 120);
  await inv(retA.id, c9004.id, 45);
  await inv(retB.id, m3320.id, 80);
  await inv(retB.id, p9100.id, 150);
  await inv(retC.id, p9100.id, 90);

  const led = (
    batchId: string,
    orgId: string,
    eventType: "ISSUED" | "SUPPLIED" | "BILLED" | "TRANSFERRED" | "RETURN_INITIATED",
    qtyDelta: number,
  ) => prisma.batchLedger.create({ data: { batchId, orgId, eventType, qtyDelta, refType: "seed" } });

  /**
   * Stock reaching a pharmacy passes through the distributor, and every hop
   * writes BOTH sides: TRANSFERRED against whoever let go of the units and
   * SUPPLIED against whoever took them on.
   *
   * A lone SUPPLIED row — which is all this seed used to write — leaves the
   * sender's books permanently showing stock it no longer has, and I7 has
   * nothing to check. Pairing them is what makes a location balance mean
   * anything.
   */
  const supply = async (batchId: string, mfgId: string, retailerId: string, qty: number) => {
    await led(batchId, mfgId, "TRANSFERRED", qty);
    await led(batchId, dist1.id, "SUPPLIED", qty);
    await led(batchId, dist1.id, "TRANSFERRED", qty);
    await led(batchId, retailerId, "SUPPLIED", qty);
  };

  // EVERY batch needs its ISSUED row. Batch.issuedQty is the declared figure;
  // the ledger row is what issuedSum() actually reads, and a batch with one and
  // not the other has a manufacturer whose books show stock leaving that never
  // arrived — which is exactly what I7 reports.
  for (const b of [b1001, b2002, b3003, k1001, p7781, c9004, m3320, p9100]) {
    await led(b.id, b.manufacturerId, "ISSUED", b.issuedQty);
  }

  await supply(b1001.id, mfg1.id, retA.id, 100);
  await supply(b1001.id, mfg1.id, retB.id, 40);
  await supply(b2002.id, mfg1.id, retC.id, 60);
  await supply(b3003.id, mfg1.id, retC.id, 200); // all 200 issued; 195 billed leaves A12's 5-unit headroom

  // 195 of 200 issued already billed — leaves 5 units of headroom, so a scan of
  // 10 breaches I1. This is acceptance A12 and nothing else; do not round it.
  await led(b3003.id, retC.id, "BILLED", 195);

  await supply(p7781.id, mfg1.id, retA.id, 200); // 180 billed below; the shelf count stays 120
  await supply(c9004.id, mfg1.id, retA.id, 45);
  await supply(m3320.id, mfg2.id, retB.id, 80);
  await supply(p9100.id, mfg1.id, retB.id, 150);
  await supply(p9100.id, mfg1.id, retC.id, 90);

  // Ordinary trading history, so batch-health bars are not empty and the
  // headroom on healthy batches is visibly different from B-3003's.
  await led(p7781.id, retA.id, "BILLED", 180);
  await led(p9100.id, retB.id, "BILLED", 95);
  await led(p9100.id, retC.id, "BILLED", 60);
  await led(c9004.id, retA.id, "BILLED", 30);

  // ---------------------------------------------------------------------
  // CDSCO reference data, imported through the real importer rather than
  // written here — so a clean database exercises the same path an operator
  // would run, and the acceptance harness has data to check against.
  // ---------------------------------------------------------------------
  for (const csv of ["nsq-alerts.csv", "licensed-entities.csv"]) {
    execFileSync("node", ["scripts/import-cdsco.mjs", `scripts/seed-data/${csv}`], {
      stdio: "pipe",
    });
  }

  // ---------------------------------------------------------------------
  // Historical compliance receipts.
  //
  // Written through the REAL buildBillPayload and the REAL audit chain, so what
  // the demo shows is what the running system produces — not a table of
  // hand-written strings. Each entry is a decision that plausibly happened in
  // the days before the demo, so every receipt screen has history in it from a
  // clean database.
  // ---------------------------------------------------------------------
  const history: {
    batchId: string;
    qty: number;
    alerts: AlertCode[];
    expired: boolean;
    daysAgo: number;
    org: string;
  }[] = [
    { batchId: p9100.id, qty: 20, alerts: [], expired: false, daysAgo: 9, org: retB.id },
    { batchId: p9100.id, qty: 12, alerts: [], expired: false, daysAgo: 7, org: retC.id },
    { batchId: p7781.id, qty: 30, alerts: [], expired: false, daysAgo: 6, org: retA.id },
    { batchId: c9004.id, qty: 15, alerts: [], expired: false, daysAgo: 5, org: retA.id },
    { batchId: b2002.id, qty: 4, alerts: [AlertCode.EXPIRED_SALE], expired: true, daysAgo: 4, org: retC.id },
    { batchId: m3320.id, qty: 6, alerts: [AlertCode.EXPIRED_SALE], expired: true, daysAgo: 3, org: retB.id },
    { batchId: b3003.id, qty: 8, alerts: [AlertCode.QUANTITY_BREACH], expired: false, daysAgo: 2, org: retC.id },
    { batchId: p9100.id, qty: 25, alerts: [], expired: false, daysAgo: 1, org: retB.id },
  ];

  for (const h of history) {
    await prisma.$transaction(async (tx) => {
      const audit = await appendAudit(tx, {
        entityType: "PosScan",
        entityId: h.batchId,
        action: `SCAN:${h.alerts.length > 0 || h.expired ? "BLOCK" : "ALLOW"}`,
        actorUserId: null,
        actorOrgId: h.org,
        payload: { batchId: h.batchId, qty: h.qty, seeded: true, alerts: h.alerts } as never,
      });

      const bill = buildBillPayload(
        { batchId: h.batchId, returnRequestId: null, quantity: h.qty },
        { alerts: h.alerts, expired: h.expired },
      );

      await tx.bill.create({
        data: {
          returnRequestId: null,
          batchId: bill.batchId,
          quantity: bill.quantity,
          status: bill.status,
          anomalyCodes: bill.anomalyCodes,
          anomalyNote: bill.anomalyNote,
          auditEventId: audit.id,
          generatedAt: new Date(Date.now() - h.daysAgo * 24 * 60 * 60 * 1000),
        },
      });
    });
  }

  // The system raises RETURN_DUE; it never fabricates a return (SPEC §4).
  // Seeding these keeps the demo's opening state deterministic — INITIATED still
  // requires a retailer action with evidence.
  const raised = await raiseDueReturns(prisma, new Date());

  // ---------------------------------------------------------------------
  // One COMPLETED return thread, already in the past, driven through the real
  // lifecycle functions rather than written straight to the tables.
  //
  // Without it a clean database gives the regulator a wall of zeros: no
  // leakage, no destroyed batch, no certificates, no critical alerts. This
  // thread is on Kelvin Labs' M-3320 and Guindy Pharmacy, deliberately clear of
  // the batches the live demo walks through, so nothing here disturbs the
  // Aurex/B-1001 story or the acceptance run.
  const historicReturn = await prisma.returnRequest.findFirst({
    where: { batchId: m3320.id, retailerId: retB.id, state: ReturnState.RETURN_DUE },
  });

  if (historicReturn) {
    const distActor = { userId: "seed", orgId: dist1.id, role: "DISTRIBUTOR" };
    const retActor = { userId: "seed", orgId: retB.id, role: "RETAILER" };
    const mfgActor = { userId: "seed", orgId: mfg2.id, role: "MANUFACTURER" };
    const facActor = { userId: "seed", orgId: fac1.id, role: "FACILITY" };
    const id = historicReturn.id;

    await prisma.$transaction((tx) =>
      transition(id, ReturnState.INITIATED, retActor, {
        to: ReturnState.INITIATED,
        declaredQty: 80,
        condition: "Sealed strips, original carton",
        photoUrl: "evidence://seed/M-3320",
      }, tx),
    );
    await prisma.$transaction((tx) =>
      transition(id, ReturnState.PICKUP_ASSIGNED, distActor, {
        to: ReturnState.PICKUP_ASSIGNED,
        pickupAt: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000),
      }, tx),
    );
    // 72 of 80 arrive. The missing 8 open a leakage record that stays open —
    // this is the signal the regulator's leakage view exists to show.
    await prisma.$transaction((tx) =>
      transition(id, ReturnState.DISTRIBUTOR_RECEIVED, distActor, {
        to: ReturnState.DISTRIBUTOR_RECEIVED,
        scannedBatchNo: "M-3320",
        receivedQty: 72,
        weightG: 44.6,
        photoUrl: "evidence://seed/intake/M-3320",
      }, tx),
    );
    await prisma.$transaction((tx) =>
      transition(id, ReturnState.MANUFACTURER_RECEIVED, mfgActor, {
        to: ReturnState.MANUFACTURER_RECEIVED,
        receivedQty: 72,
      }, tx),
    );
    const sched = await prisma.$transaction((tx) =>
      transition(id, ReturnState.DISPOSAL_SCHEDULED, mfgActor, {
        to: ReturnState.DISPOSAL_SCHEDULED,
        facilityId: fac1.id,
        qty: 72,
        scheduledDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      }, tx),
    );
    const disposalId = sched.disposalRequestId!;
    await prisma.$transaction((tx) =>
      transition(id, ReturnState.FACILITY_RECEIVED, facActor, {
        to: ReturnState.FACILITY_RECEIVED,
        disposalRequestId: disposalId,
      }, tx),
    );
    await prisma.$transaction((tx) =>
      transition(id, ReturnState.CERTIFIED_DESTROYED, facActor, {
        to: ReturnState.CERTIFIED_DESTROYED,
        disposalRequestId: disposalId,
        qty: 72,
      }, tx),
    );

    // The batch is DESTROYED now, so a scan of it is a resurrected-batch
    // refusal — giving the retailer's receipts page a flagged row on day one.
    await prisma.$transaction(async (tx) => {
      const audit = await appendAudit(tx, {
        entityType: "PosScan",
        entityId: m3320.id,
        action: "SCAN:BLOCK:RESURRECTED_BATCH",
        actorUserId: null,
        actorOrgId: retB.id,
        payload: { batchId: m3320.id, qty: 2, seeded: true } as never,
      });
      const bill = buildBillPayload(
        { batchId: m3320.id, returnRequestId: null, quantity: 2 },
        { alerts: [AlertCode.RESURRECTED_BATCH], expired: true },
      );
      await tx.bill.create({
        data: { ...bill, auditEventId: audit.id, generatedAt: new Date(Date.now() - 36e5) },
      });
      await tx.alert.create({
        data: {
          code: AlertCode.RESURRECTED_BATCH,
          severity: "CRITICAL",
          batchId: m3320.id,
          orgId: retB.id,
          payload: { seeded: true, batchNo: "M-3320" } as never,
        },
      });
    });
  }

  // A refusal on stock Anna Nagar Medicals actually holds, so the retailer
  // landing on /receipts sees a flagged row without having to run the demo first.
  await prisma.$transaction(async (tx) => {
    const audit = await appendAudit(tx, {
      entityType: "PosScan",
      entityId: c9004.id,
      action: "SCAN:BLOCK:EXPIRED_SALE",
      actorUserId: null,
      actorOrgId: retA.id,
      payload: { batchId: c9004.id, qty: 3, seeded: true } as never,
    });
    const bill = buildBillPayload(
      { batchId: c9004.id, returnRequestId: null, quantity: 3 },
      { alerts: [AlertCode.EXPIRED_SALE], expired: true },
    );
    await tx.bill.create({
      data: { ...bill, auditEventId: audit.id, generatedAt: new Date(Date.now() - 2 * 36e5) },
    });
  });

  // =====================================================================
  // DEMO SCENARIOS — quantity accountability, recall, consumer, evidence.
  //
  // Every number below is load-bearing for one act of the demo. Where the real
  // service exists, it is called rather than imitated: transfers go through
  // executeTransfer, recalls through issueHoldOrRecall, consumer bills through
  // the same POS decision function a live terminal uses.
  //
  // All organisations, people and products here are fictional.
  // =====================================================================

  // --- the authorised distribution network ------------------------------
  // Kept SEPARATE from CDSCO licensing on purpose: an entity can hold a valid
  // licence and still not be an authorised route for a given maker's stock.
  const route = (fromOrgId: string, toOrgId: string) =>
    prisma.authorizedRoute.create({ data: { fromOrgId, toOrgId } });

  const retD = await org("Adyar Health Mart", "RETAILER", "DL/TN/4404", "Adyar", dist1.id);
  const retE = await org("Tambaram Medicals", "RETAILER", "DL/TN/4405", "Tambaram", dist1.id);
  for (const [email, o] of [
    ["retd@adyar.example", retD],
    ["rete@tambaram.example", retE],
  ] as const) {
    await prisma.user.create({
      data: { email, passwordHash, role: "RETAILER", organizationId: o.id },
    });
  }

  await route(mfg1.id, dist1.id);
  await route(mfg2.id, dist1.id);
  for (const r of [retA, retB, retC, retD, retE]) await route(dist1.id, r.id);

  // --- ACT 3: one batch, five pharmacies, a 300-unit hole ----------------
  // 10,000 issued -> 8,000 sold -> 2,000 outstanding -> 1,700 collected.
  // The 300 that never came back are Adyar's 100 and Tambaram's 200, and the
  // per-location table is what names them. Do not round these figures.
  const amx = await mkBatch(mfg1.id, "AMX-25081", p1.id, 10_000, "2026-08-20T00:00:00Z");
  await led(amx.id, mfg1.id, "ISSUED", 10_000);

  const act3: [typeof retA, number, number, number][] = [
    // pharmacy, supplied, sold, returned
    [retA, 3_000, 2_600, 400],
    [retB, 2_500, 2_100, 400],
    [retC, 2_000, 1_600, 400],
    [retD, 1_500, 1_100, 300], // 100 short
    [retE, 1_000, 600, 200], // 200 short
  ];
  for (const [ret, supplied, sold, returned] of act3) {
    await supply(amx.id, mfg1.id, ret.id, supplied);
    await led(amx.id, ret.id, "BILLED", sold);
    if (returned > 0) await led(amx.id, ret.id, "RETURN_INITIATED", returned);
    await inv(ret.id, amx.id, supplied - sold - returned);
  }

  // --- I7: a location whose books do not add up -------------------------
  // Framed as it usually arrives in reality — a pharmacy migrated from paper
  // whose opening stock was never captured, so its sales exceed its recorded
  // receipts. An inconsistency to reconcile, NOT a finding of diversion.
  const lgc = await mkBatch(mfg1.id, "LGC-0091", p3.id, 500, "2027-09-30T00:00:00Z");
  await led(lgc.id, mfg1.id, "ISSUED", 500);
  await supply(lgc.id, mfg1.id, retE.id, 100);
  await led(lgc.id, retE.id, "BILLED", 140); // -40: more sold than ever received

  // --- ACT 6: a batch the regulator recalls ------------------------------
  const rcl = await mkBatch(mfg2.id, "RCL-4402", p4.id, 900, "2028-06-30T00:00:00Z");
  await led(rcl.id, mfg2.id, "ISSUED", 900);
  await supply(rcl.id, mfg2.id, retB.id, 300);
  await led(rcl.id, retB.id, "BILLED", 120);
  await inv(retB.id, rcl.id, 180);

  // --- a batch under investigation, not yet recalled ---------------------
  const hld = await mkBatch(mfg1.id, "HLD-7788", p5.id, 400, "2027-11-30T00:00:00Z");
  await led(hld.id, mfg1.id, "ISSUED", 400);
  await supply(hld.id, mfg1.id, retC.id, 150);
  await led(hld.id, retC.id, "BILLED", 40);
  await inv(retC.id, hld.id, 110);

  // --- consumer purchase bills ------------------------------------------
  // Written before the recall below, exactly as a real purchase would be: the
  // customer bought it while the batch was clean, and their QR turns red later
  // WITHOUT the receipt being edited. That is the whole point of resolving the
  // token against the live record instead of a status frozen at sale time.
  const consumerBill = async (
    pharmacy: typeof retA,
    billNo: string,
    token: string,
    soldAt: Date,
    lines: { batch: typeof amx; qty: number; product: string; mfg: typeof mfg1 }[],
  ) =>
    prisma.consumerBill.create({
      data: {
        billNo,
        token,
        pharmacyId: pharmacy.id,
        soldAt,
        lines: {
          create: lines.map((l) => ({
            batchId: l.batch.id,
            productName: l.product,
            manufacturerName: l.mfg.name,
            manufacturerLicenseNo: l.mfg.licenseNo,
            batchNo: l.batch.batchNo,
            expiryDate: l.batch.expiryDate,
            qty: l.qty,
          })),
        },
      },
    });

  const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 36e5);

  // Multiple medicines, two different manufacturers, and a single-tablet line —
  // the most common real transaction, and the one a per-pack model cannot hold.
  const billValid = await consumerBill(
    retB,
    "RCCP-20260908-001",
    "demo-valid-bill-token-0001",
    daysAgo(2),
    [
      { batch: p9100, qty: 10, product: "Paracetamol 650mg", mfg: mfg1 },
      { batch: k1001, qty: 1, product: "Amoxicillin 500mg", mfg: mfg2 },
    ],
  );

  const billRecalled = await consumerBill(
    retB,
    "RCCP-20260909-002",
    "demo-recalled-bill-token-002",
    daysAgo(1),
    [{ batch: rcl, qty: 14, product: "Metformin 500mg", mfg: mfg2 }],
  );

  // --- the recall and the hold, through the real service -----------------
  const regUser = await prisma.user.findFirstOrThrow({ where: { organizationId: reg1.id } });
  const regActor = { userId: regUser.id, orgId: reg1.id, role: "REGULATOR" };

  await prisma.$transaction((tx) =>
    issueHoldOrRecall(tx, regActor, {
      batchId: rcl.id,
      action: "RECALL_ISSUED",
      reason:
        "Dissolution failure confirmed on two retained samples by the state testing laboratory. All unsold stock to be withdrawn immediately.",
    }),
  );

  await prisma.$transaction((tx) =>
    issueHoldOrRecall(tx, regActor, {
      batchId: hld.id,
      action: "HOLD_ISSUED",
      reason:
        "Three adverse-reaction reports received from one district within a week. Held pending sample testing; no finding has been made.",
    }),
  );

  // --- an unauthorised movement, through the real transfer service -------
  // Pharmacy to pharmacy, with no route between them. It is RECORDED and
  // flagged, not refused: refusing it would only push the stock off the books.
  const retBUser = await prisma.user.findFirstOrThrow({ where: { organizationId: retB.id } });
  await prisma.$transaction((tx) =>
    executeTransfer(
      tx,
      { userId: retBUser.id, orgId: retB.id },
      { batchId: p9100.id, toOrgId: retC.id, qty: 20, note: "Stock lent to cover a shortage" },
    ),
  );

  // --- a return that stopped moving (I8) ---------------------------------
  // The retailer initiated it three weeks ago and nobody upstream ever came to
  // collect. Nothing in I1-I6 fires, because nothing HAPPENED — which is the
  // whole point of I8, and why the stall needs its own batch: any thread the
  // acceptance run drives forward stops being stalled.
  const stl = await mkBatch(mfg1.id, "STL-5150", p3.id, 300, "2026-07-25T00:00:00Z");
  await led(stl.id, mfg1.id, "ISSUED", 300);
  await supply(stl.id, mfg1.id, retD.id, 120);
  await led(stl.id, retD.id, "BILLED", 60);
  await inv(retD.id, stl.id, 60);

  const stalledRow = await prisma.returnRequest.create({
    data: {
      batchId: stl.id,
      retailerId: retD.id,
      distributorId: dist1.id,
      manufacturerId: mfg1.id,
      state: "INITIATED",
      dueBy: new Date(stl.expiryDate.getTime() + 30 * 24 * 36e5),
      declaredQty: 60,
      condition: "Sealed, stored at room temperature",
      initiatedAt: daysAgo(21),
    },
  });
  await led(stl.id, retD.id, "RETURN_INITIATED", 60);
  await prisma.batch.update({
    where: { id: stl.id },
    data: { registryStatus: "IN_RETURN_PIPELINE" },
  });
  // updatedAt is @updatedAt, so the client cannot backdate it.
  await prisma.$executeRaw`UPDATE "ReturnRequest" SET "updatedAt" = NOW() - INTERVAL '21 days' WHERE id = ${stalledRow.id}`;

  // --- citizen reports ---------------------------------------------------
  const citizenReport = async (
    manufacturerRef: string,
    batchNo: string,
    batchId: string | null,
    reason: "SUSPECTED_EXPIRED" | "SUSPECTED_COUNTERFEIT" | "SOLD_AFTER_RECALL",
    description: string,
    location: string,
  ) =>
    prisma.$transaction(async (tx) => {
      const audit = await appendAudit(tx, {
        entityType: "Batch",
        entityId: batchId ?? `UNRESOLVED:${batchNo}`,
        action: "CITIZEN_REPORTED",
        actorUserId: null,
        actorOrgId: null,
        payload: { rawManufacturerRef: manufacturerRef, rawBatchNo: batchNo, reason } as never,
      });
      await tx.citizenReport.create({
        data: {
          batchId,
          rawManufacturerRef: manufacturerRef,
          rawBatchNo: batchNo,
          reason,
          description,
          location,
          auditEventId: audit.id,
        },
      });
      await tx.alert.create({
        data: {
          code: "CITIZEN_REPORT",
          severity: "LOW",
          batchId,
          payload: { reason, rawBatchNo: batchNo, resolved: batchId !== null } as never,
        },
      });
    });

  await citizenReport(
    mfg2.licenseNo,
    "RCL-4402",
    rcl.id,
    "SOLD_AFTER_RECALL",
    "Bought this last week and have just seen the recall notice. The pharmacy has not contacted me.",
    "Guindy, Chennai",
  );
  // Unresolved on purpose: an invented batch number is the most valuable report
  // there is, and rejecting it for failing to match would discard the signal.
  await citizenReport(
    mfg1.licenseNo,
    "B-9999",
    null,
    "SUSPECTED_COUNTERFEIT",
    "Printing on the strip is blurred and the foil looks re-sealed. No such batch number appears anywhere.",
    "Velachery, Chennai",
  );

  console.log("Seeded.");
  console.table({
    orgs: await prisma.organization.count(),
    users: await prisma.user.count(),
    products: await prisma.product.count(),
    batches: await prisma.batch.count(),
    inventoryRows: await prisma.inventory.count(),
    ledgerRows: await prisma.batchLedger.count(),
    returnsRaised: raised,
    complianceReceipts: await prisma.bill.count(),
    receiptsRefused: await prisma.bill.count({ where: { status: "EXPIRED" } }),
    nsqAlerts: await prisma.nsqAlert.count(),
    licensedEntities: await prisma.licensedEntity.count(),
    openLeakage: await prisma.leakageRecord.count({ where: { status: "OPEN" } }),
    certificates: await prisma.destructionCertificate.count(),
    alerts: await prisma.alert.count(),
    transfers: await prisma.transfer.count(),
    authorizedRoutes: await prisma.authorizedRoute.count(),
    holdsAndRecalls: await prisma.holdRecallOrder.count(),
    consumerBills: await prisma.consumerBill.count(),
    citizenReports: await prisma.citizenReport.count(),
    login: `any email above / ${PASSWORD}`,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
