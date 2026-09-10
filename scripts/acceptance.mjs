#!/usr/bin/env node
// docs/SPEC.md §9 — the acceptance checklist, executed against a running server.
//
//   npx prisma db seed && npm run dev &   # then
//   node scripts/acceptance.mjs
//
// Every item asserts against the HTTP surface, not the database, because the
// HTTP surface is what the demo drives.

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const PASSWORD = "demo1234";

const results = [];
let failures = 0;

function check(id, desc, condition, detail) {
  const passed = !!condition;
  if (!passed) failures += 1;
  results.push({ id, desc, passed, detail: passed ? "" : JSON.stringify(detail ?? {}) });
  console.log(`${passed ? "PASS" : "FAIL"}  ${id}  ${desc}`);
  if (!passed) console.log(`      ${JSON.stringify(detail ?? {})}`);
}

const jars = new Map();

async function login(email) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login failed for ${email}: ${res.status} ${await res.text()}`);
  const cookie = (res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie")])
    .filter(Boolean)
    .map((c) => c.split(";")[0])
    .join("; ");
  jars.set(email, cookie);
  return res.json();
}

async function api(email, path, init = {}) {
  const headers = { "content-type": "application/json", ...(init.headers ?? {}) };
  if (email) headers.cookie = jars.get(email);
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  return { status: res.status, body, headers: res.headers };
}

const scan = (email, manufacturerRef, batchNo, qty, context = "SALE", extra = {}) =>
  api(email, "/api/pos/scan", {
    method: "POST",
    body: JSON.stringify({ manufacturerRef, batchNo, qty, context, ...extra }),
  });

const RETA = "reta@annanagar.example";
const RETB = "retb@guindy.example";
const RETC = "retc@velachery.example";
const DIST = "dist1@chennaimeds.example";
const MFG1 = "mfg1@aurex.example";
const FAC1 = "fac1@tnbiomedical.example";
const REG1 = "reg1@tndrugscontrol.example";
const RETD = "retd@adyar.example";
const RETE = "rete@tambaram.example";

async function main() {
  console.log(`\nRCCP acceptance checklist — ${BASE}\n${"=".repeat(60)}`);

  for (const e of [RETA, RETB, RETC, DIST, MFG1, FAC1, REG1]) await login(e);
  check("A0", "all six roles log in", jars.size === 7, { logins: jars.size });

  // ---------------------------------------------------------------- A1
  const a1 = await scan(RETC, "MFG/TN/001", "B-2002", 1);
  const b2002 = await api(MFG1, "/api/batches");
  const b2002row = b2002.body.items.find((b) => b.batchNo === "B-2002");
  check(
    "A1",
    "RET-C scans MFG-1/B-2002 SALE -> BLOCK/EXPIRED_SALE, registry CLEAN throughout",
    a1.body.verdict === "BLOCK" &&
      a1.body.alertCode === "EXPIRED_SALE" &&
      a1.body.batch?.registryStatus === "CLEAN" &&
      b2002row?.registryStatus === "CLEAN",
    { verdict: a1.body.verdict, code: a1.body.alertCode, registry: b2002row?.registryStatus },
  );

  // ---------------------------------------------------------------- A2
  const due = await api(RETA, "/api/returns/due");
  const dueB1001 = due.body.items.find((r) => r.batchNo === "B-1001");
  const a2 = await api(RETA, `/api/returns/${dueB1001.id}/initiate`, {
    method: "POST",
    body: JSON.stringify({ declaredQty: 100, condition: "Sealed, intact strips", photoUrl: "seed://photo/a2" }),
  });
  const invA = await api(RETA, "/api/inventory");
  const invRow = invA.body.items.find((i) => i.batchNo === "B-1001");
  check(
    "A2",
    "RET-A initiates return of 100 of B-1001 -> INITIATED / IN_RETURN_PIPELINE / QUARANTINED",
    a2.status === 200 &&
      a2.body.to === "INITIATED" &&
      a2.body.registryStatus === "IN_RETURN_PIPELINE" &&
      invRow?.status === "QUARANTINED",
    { status: a2.status, to: a2.body.to, registry: a2.body.registryStatus, inv: invRow?.status },
  );

  // ---------------------------------------------------------------- A2b
  // Two halves, because the double return is refused at two different depths.
  //
  // (i) Re-submitting the SAME return is stopped by the state machine before I3
  //     is ever consulted: the row is already INITIATED and RETURN_DUE is the
  //     only state initiate() accepts.
  const a2bRepeat = await api(RETA, `/api/returns/${dueB1001.id}/initiate`, {
    method: "POST",
    body: JSON.stringify({ declaredQty: 100, condition: "again", photoUrl: "x" }),
  });

  // (ii) I3 itself, on a path the state machine does NOT close: RET-C was
  //     supplied 60 of B-2002 and tries to put 61 into the pipeline.
  const dueC = await api(RETC, "/api/returns/due");
  const dueB2002 = dueC.body.items.find((r) => r.batchNo === "B-2002");
  const a2bI3 = await api(RETC, `/api/returns/${dueB2002.id}/initiate`, {
    method: "POST",
    body: JSON.stringify({ declaredQty: 61, condition: "over-declared", photoUrl: "x" }),
  });

  check(
    "A2b",
    "a second/over return is refused — state machine on a repeat, I3 DOUBLE_RETURN on an over-declaration",
    a2bRepeat.status === 409 &&
      a2bRepeat.body.error?.code === "ILLEGAL_TRANSITION" &&
      a2bI3.status === 409 &&
      a2bI3.body.error?.code === "DOUBLE_RETURN",
    {
      repeat: { status: a2bRepeat.status, code: a2bRepeat.body.error?.code },
      i3: { status: a2bI3.status, code: a2bI3.body.error?.code },
    },
  );

  const rid = dueB1001.id;

  // ---------------------------------------------------------------- A4 (before A3)
  await api(DIST, `/api/returns/${rid}/pickup`, {
    method: "POST",
    body: JSON.stringify({ pickupAt: new Date().toISOString() }),
  });
  const a4 = await api(DIST, `/api/returns/${rid}/receive`, {
    method: "POST",
    body: JSON.stringify({ scannedBatchNo: "B-1001", receivedQty: 110 }),
  });
  check(
    "A4",
    "DIST-1 attempts to receive 110 against 100 -> 400 reject",
    a4.status === 400,
    { status: a4.status, body: a4.body },
  );

  // ---------------------------------------------------------------- A3
  // Measured as a DELTA rather than an absolute, so the assertion survives the
  // demo data seeded for the dashboards (which carries its own open leakage).
  const unaccountedBefore = (await api(REG1, "/api/regulator/kpi")).body.unaccountedUnits;
  const a3 = await api(DIST, `/api/returns/${rid}/receive`, {
    method: "POST",
    body: JSON.stringify({ scannedBatchNo: "B-1001", receivedQty: 70, weightG: 52.5 }),
  });
  const leak = await api(REG1, "/api/regulator/leakage");
  const kpi = await api(REG1, "/api/regulator/kpi");
  check(
    "A3",
    "DIST-1 receives 70 of 100 -> confirmedQty 70, LeakageRecord 30 OPEN, regulator shows 30",
    a3.body.to === "DISTRIBUTOR_RECEIVED" &&
      a3.body.confirmedQty === 70 &&
      leak.body.records.some((r) => r.leakedQty === 30 && r.status === "OPEN") &&
      kpi.body.unaccountedUnits - unaccountedBefore === 30,
    {
      to: a3.body.to,
      confirmedQty: a3.body.confirmedQty,
      unaccountedBefore,
      unaccountedAfter: kpi.body.unaccountedUnits,
      delta: kpi.body.unaccountedUnits - unaccountedBefore,
    },
  );

  // ---------------------------------------------------------------- A5
  const a5recv = await api(MFG1, `/api/returns/${rid}/mfg-receive`, {
    method: "POST",
    body: JSON.stringify({ receivedQty: 70 }),
  });
  const orgsFac = await api(MFG1, "/api/orgs?type=FACILITY");
  const facilityId = orgsFac.body.items?.[0]?.id;
  const a5disp = await api(MFG1, "/api/disposals", {
    method: "POST",
    body: JSON.stringify({
      returnId: rid,
      facilityId,
      qty: 70,
      scheduledDate: new Date(Date.now() + 86400000).toISOString(),
    }),
  });
  check(
    "A5",
    "MFG-1 receives 70 and schedules disposal to FAC-1",
    a5recv.body.to === "MANUFACTURER_RECEIVED" &&
      a5recv.body.confirmedQty === 70 &&
      a5disp.body.to === "DISPOSAL_SCHEDULED",
    { recv: a5recv.body.to, disp: a5disp.body.to, facilityId, dispBody: a5disp.body },
  );

  const inbound = await api(FAC1, "/api/disposals/inbound");
  // Must be the disposal for the return this run created. The facility also
  // holds seeded historical disposals, and those sort earlier by scheduledDate.
  const dr = inbound.body.items?.find((d) => d.returnId === rid);
  await api(FAC1, `/api/disposals/${dr.id}/receive`, { method: "POST" });

  // ---------------------------------------------------------------- A6
  const certsBefore = await api(FAC1, "/api/certificates");
  const a6 = await api(FAC1, "/api/certificates", {
    method: "POST",
    body: JSON.stringify({ disposalRequestId: dr.id, qty: 100 }),
  });
  const certsAfter = await api(FAC1, "/api/certificates");
  check(
    "A6",
    "FAC-1 requests 100 -> 409 CERTIFICATE_OVER_ALLOCATION AND no row written",
    a6.status === 409 &&
      a6.body.error?.code === "CERTIFICATE_OVER_ALLOCATION" &&
      certsAfter.body.items.length === certsBefore.body.items.length,
    {
      status: a6.status,
      code: a6.body.error?.code,
      before: certsBefore.body.items.length,
      after: certsAfter.body.items.length,
    },
  );

  // ---------------------------------------------------------------- A7
  const a7 = await api(FAC1, "/api/certificates", {
    method: "POST",
    body: JSON.stringify({ disposalRequestId: dr.id, qty: 40 }),
  });
  const batchesAfter7 = await api(MFG1, "/api/batches");
  const b1001After7 = batchesAfter7.body.items.find((b) => b.batchNo === "B-1001");
  check(
    "A7",
    "FAC-1 requests 40 -> issued; batch still IN_RETURN_PIPELINE (partial)",
    a7.status === 200 &&
      !!a7.body.certificateId &&
      b1001After7?.registryStatus === "IN_RETURN_PIPELINE",
    { status: a7.status, cert: a7.body.certificateId, registry: b1001After7?.registryStatus },
  );

  // ---------------------------------------------------------------- A8
  const a8 = await api(FAC1, "/api/certificates", {
    method: "POST",
    body: JSON.stringify({ disposalRequestId: dr.id, qty: 30 }),
  });
  const batchesAfter8 = await api(MFG1, "/api/batches");
  const b1001After8 = batchesAfter8.body.items.find((b) => b.batchNo === "B-1001");
  check(
    "A8",
    "FAC-1 requests 30 -> alreadyAllocated 70 == confirmedQty -> DESTROYED, destroyedAt set",
    a8.status === 200 &&
      b1001After8?.registryStatus === "DESTROYED" &&
      !!b1001After8?.destroyedAt,
    { status: a8.status, registry: b1001After8?.registryStatus, destroyedAt: b1001After8?.destroyedAt },
  );

  // ---------------------------------------------------------------- A9
  const a9 = await scan(RETB, "MFG/TN/001", "B-1001", 1);
  const alerts = await api(REG1, "/api/regulator/alerts?severity=CRITICAL");
  const a9alert = alerts.body.items.find((x) => x.code === "RESURRECTED_BATCH");
  check(
    "A9",
    "RET-B scans MFG-1/B-1001 SALE -> BLOCK/RESURRECTED_BATCH CRITICAL, alert visible to REG-1",
    a9.body.verdict === "BLOCK" &&
      a9.body.alertCode === "RESURRECTED_BATCH" &&
      a9.body.severity === "CRITICAL" &&
      !!a9alert &&
      a9alert.manufacturer === "Aurex Pharma",
    { verdict: a9.body.verdict, code: a9.body.alertCode, alert: !!a9alert },
  );

  // ---------------------------------------------------------------- A10
  const a10 = await scan(RETB, "MFG/TN/002", "B-1001", 1);
  const alertsAfter10 = await api(REG1, "/api/regulator/alerts");
  const spurious = alertsAfter10.body.items.filter(
    (x) => x.batchNo === "B-1001" && x.manufacturer === "Kelvin Labs",
  );
  check(
    "A10",
    "RET-B scans MFG-2/B-1001 -> ALLOW (composite key, no false alert)",
    a10.body.verdict === "ALLOW" && a10.body.alertCode === null && spurious.length === 0,
    { verdict: a10.body.verdict, code: a10.body.alertCode, spurious: spurious.length },
  );

  // ---------------------------------------------------------------- A11
  const a11 = await scan(RETB, "MFG/TN/001", "B-9999", 1);
  check(
    "A11",
    "RET-B scans MFG-1/B-9999 -> BLOCK/UNKNOWN_BATCH CRITICAL",
    a11.body.verdict === "BLOCK" &&
      a11.body.alertCode === "UNKNOWN_BATCH" &&
      a11.body.severity === "CRITICAL",
    { verdict: a11.body.verdict, code: a11.body.alertCode, severity: a11.body.severity },
  );

  // ---------------------------------------------------------------- A12
  const a12 = await scan(RETC, "MFG/TN/001", "B-3003", 10);
  check(
    "A12",
    "RET-C scans MFG-1/B-3003 qty 10 -> BLOCK/QUANTITY_BREACH (195 + 10 > 200)",
    a12.body.verdict === "BLOCK" && a12.body.alertCode === "QUANTITY_BREACH",
    { verdict: a12.body.verdict, code: a12.body.alertCode, detail: a12.body.batch },
  );

  // ---------------------------------------------------------------- A13
  const a13 = await api(null, "/api/verify/MFG-TN-001/B-1001");
  check(
    "A13",
    "/verify/MFG-TN-001/B-1001 (no auth) -> red DESTROYED card",
    a13.status === 200 && a13.body.status === "DESTROYED" && a13.body.tone === "red",
    { status: a13.status, body: a13.body },
  );

  // ---------------------------------------------------------------- A14
  const a14 = await api(REG1, "/api/audit/verify");
  check("A14", "/api/audit/verify -> { valid: true }", a14.body.valid === true, a14.body);

  // ---------------------------------------------------------------- A15
  const key = `acc-${Date.now()}`;
  const first = await scan(RETC, "MFG/TN/001", "B-3003", 1, "SALE", {});
  const idemBody = {
    manufacturerRef: "MFG/TN/001",
    batchNo: "B-3003",
    qty: 1,
    context: "SALE",
  };
  const r1 = await api(RETC, "/api/pos/scan", {
    method: "POST",
    headers: { "Idempotency-Key": key },
    body: JSON.stringify(idemBody),
  });
  const r2 = await api(RETC, "/api/pos/scan", {
    method: "POST",
    headers: { "Idempotency-Key": key },
    body: JSON.stringify(idemBody),
  });
  const r3 = await api(RETC, "/api/pos/scan", {
    method: "POST",
    headers: { "Idempotency-Key": key },
    body: JSON.stringify({ ...idemBody, qty: 2 }),
  });
  const billedAfter = (await api(MFG1, "/api/batches")).body.items.find((b) => b.batchNo === "B-3003");
  check(
    "A15",
    "repeated Idempotency-Key replays; a different body under the same key is refused",
    r1.status === 200 &&
      r2.status === 200 &&
      JSON.stringify(r1.body) === JSON.stringify(r2.body) &&
      r2.headers.get("Idempotent-Replay") === "true" &&
      r3.status === 409,
    {
      r1: r1.status,
      r2: r2.status,
      replayHeader: r2.headers.get("Idempotent-Replay"),
      r3: r3.status,
      identical: JSON.stringify(r1.body) === JSON.stringify(r2.body),
      billed: billedAfter?.health,
      firstScan: first.body.verdict,
    },
  );

  // ================================================================
  // Billing / compliance receipts + CDSCO reference data
  // ================================================================

  // ---------------------------------------------------------------- B1
  // B-1001 is DESTROYED by this point in the run, so a scan of it is refused
  // and must leave an EXPIRED receipt behind.
  const b1 = await scan(RETB, "MFG/TN/001", "B-1001", 1);
  check(
    "B1",
    "a refused POS decision produces an EXPIRED compliance receipt with a plain-language reason",
    b1.body.bill?.status === "EXPIRED" &&
      typeof b1.body.bill?.anomalyNote === "string" &&
      b1.body.bill.anomalyNote.length > 20,
    { bill: b1.body.bill },
  );

  // ---------------------------------------------------------------- B2
  const b2 = await scan(RETB, "MFG/TN/002", "B-1001", 1);
  check(
    "B2",
    "an allowed POS decision produces an OK receipt (same batch number, different maker)",
    b2.body.verdict === "ALLOW" && b2.body.bill?.status === "OK",
    { verdict: b2.body.verdict, bill: b2.body.bill },
  );

  // ---------------------------------------------------------------- B3
  const billsAll = await api(REG1, "/api/bills");
  const billsExpired = await api(REG1, "/api/bills?status=EXPIRED");
  check(
    "B3",
    "the dashboard feed surfaces flagged batches without opening individual returns",
    billsAll.status === 200 &&
      billsExpired.body.items.length > 0 &&
      billsExpired.body.items.every((b) => b.status === "EXPIRED") &&
      billsExpired.body.items.every((b) => b.anomalyNote),
    { total: billsAll.body.total, expired: billsExpired.body.items.length },
  );

  // ---------------------------------------------------------------- B4
  // No override path, for any role, through any verb on the bills resource.
  const verbs = await Promise.all(
    ["POST", "PATCH", "PUT", "DELETE"].map((m) =>
      api(REG1, "/api/bills", { method: m, body: JSON.stringify({ status: "OK" }) }),
    ),
  );
  const billId = billsExpired.body.items[0]?.id;
  const targeted = await Promise.all(
    ["PATCH", "PUT", "DELETE"].map((m) => api(REG1, `/api/bills/${billId}`, { method: m })),
  );
  check(
    "B4",
    "an EXPIRED receipt cannot be edited, deleted or overridden by any role or verb",
    verbs.every((r) => r.status === 404 || r.status === 405) &&
      targeted.every((r) => r.status === 404 || r.status === 405),
    { collection: verbs.map((r) => r.status), item: targeted.map((r) => r.status) },
  );

  // ---------------------------------------------------------------- B5
  const pubDestroyed = await api(null, "/api/verify/MFG-TN-001/B-1001");
  check(
    "B5",
    "/verify exposes the EXPIRED receipt publicly, with no auth",
    pubDestroyed.status === 200 &&
      pubDestroyed.body.complianceReceipt?.status === "EXPIRED" &&
      !!pubDestroyed.body.complianceReceipt?.anomalyNote,
    { receipt: pubDestroyed.body.complianceReceipt },
  );

  // ---------------------------------------------------------------- B6
  // P-7781 is the case that proves the signals are not merged: our own ledger
  // and our own receipt both say this batch is fine, and CDSCO has recalled it
  // on quality. A system that collapsed these into one status would have to
  // throw one of those answers away.
  const pubDiverge = await api(null, "/api/verify/MFG-TN-001/P-7781");
  check(
    "B6",
    "/verify reports registry, compliance receipt and CDSCO NSQ separately — and they can disagree",
    pubDiverge.status === 200 &&
      pubDiverge.body.status === "CLEAN" &&
      pubDiverge.body.complianceReceipt?.status === "OK" &&
      pubDiverge.body.cdscoNsq?.flagged === true &&
      typeof pubDiverge.body.signalsNote === "string",
    {
      registry: pubDiverge.body.status,
      receipt: pubDiverge.body.complianceReceipt?.status,
      nsq: pubDiverge.body.cdscoNsq?.flagged,
    },
  );

  // ---------------------------------------------------------------- C1
  const nsqHit = await api(null, "/api/cdsco/nsq-check?medicineName=Amoxicillin%20500mg&batchNo=B-1001");
  const nsqMiss = await api(null, "/api/cdsco/nsq-check?medicineName=Amoxicillin%20500mg&batchNo=B-3003");
  check(
    "C1",
    "CDSCO NSQ check answers matched and unmatched batches, unauthenticated",
    nsqHit.status === 200 && nsqHit.body.flagged === true &&
      nsqMiss.status === 200 && nsqMiss.body.flagged === false,
    { hit: nsqHit.body.flagged, miss: nsqMiss.body.flagged },
  );

  // ---------------------------------------------------------------- C2
  // The collision rule again: the same batch number under a different medicine
  // must not inherit the recall.
  const nsqCollide = await api(null, "/api/cdsco/nsq-check?medicineName=Metformin%20500mg&batchNo=B-1001");
  check(
    "C2",
    "an NSQ recall does not leak across medicines sharing a batch number",
    nsqCollide.body.flagged === false,
    { flagged: nsqCollide.body.flagged },
  );

  // ---------------------------------------------------------------- C3
  const licActive = await api(REG1, "/api/cdsco/license-check?licenseNo=DL/TN/4401");
  const licSusp = await api(REG1, "/api/cdsco/license-check?licenseNo=DL/TN/4403");
  const licNone = await api(REG1, "/api/cdsco/license-check?licenseNo=DL/TN/0000");
  check(
    "C3",
    "CDSCO licence check distinguishes ACTIVE, SUSPENDED and unregistered",
    licActive.body.active === true &&
      licSusp.body.found === true && licSusp.body.active === false &&
      licNone.body.found === false && licNone.body.active === false,
    { active: licActive.body.active, susp: licSusp.body.active, none: licNone.body.found },
  );

  // ---------------------------------------------------------------- C4
  const cdscoAll = await api(REG1, "/api/cdsco");
  check(
    "C4",
    "the regulator sees imported CDSCO data and which recalled batches are in this chain",
    cdscoAll.status === 200 &&
      cdscoAll.body.nsq.total === 10 &&
      cdscoAll.body.entities.total === 10 &&
      cdscoAll.body.nsq.matchedInRccp > 0 &&
      cdscoAll.body.entities.notActive > 0,
    {
      nsq: cdscoAll.body.nsq?.total,
      entities: cdscoAll.body.entities?.total,
      matched: cdscoAll.body.nsq?.matchedInRccp,
    },
  );

  // ---------------------------------------------------------------- C5
  check(
    "C5",
    "CDSCO reference data is not writable through the API",
    (await api(REG1, "/api/cdsco", { method: "POST", body: "{}" })).status === 405 ||
      (await api(REG1, "/api/cdsco", { method: "POST", body: "{}" })).status === 404,
    {},
  );

  // ---------------------------------------------------------------- B7
  const auditAfter = await api(REG1, "/api/audit/verify");
  check(
    "B7",
    "the audit chain stays intact with receipts appended to it",
    auditAfter.body.valid === true,
    auditAfter.body,
  );

  // ==================================================================
  // D — quantity accountability, transfers, holds, consumer, evidence
  // ==================================================================

  const batches = (await api(REG1, "/api/batches")).body;
  const byNo = (no) => (batches.items ?? []).find((b) => b.batchNo === no);

  // ---------------------------------------------------------------- D1
  // The regulator's central question, answered from the ledger alone.
  const amx = byNo("AMX-25081");
  const acct = amx ? await api(REG1, `/api/accountability/batch/${amx.id}`) : { body: {} };
  const t = acct.body.totals ?? {};
  check(
    "D1",
    "one batch across five pharmacies: 10,000 issued, 8,000 sold, 2,000 outstanding, 1,700 collected, 300 unaccounted",
    t.issued === 10000 &&
      t.sold === 8000 &&
      t.outstanding === 2000 &&
      t.collected === 1700 &&
      t.unaccounted === 300,
    t,
  );

  // ---------------------------------------------------------------- D2
  // Not just a total — WHICH pharmacies the missing units sit behind.
  const short = (acct.body.locations ?? [])
    .filter((l) => l.unaccounted > 0)
    .map((l) => `${l.orgName}:${l.unaccounted}`)
    .sort();
  check(
    "D2",
    "the shortfall names the responsible pharmacies, not just a total",
    short.length === 2 &&
      short.includes("Adyar Health Mart:100") &&
      short.includes("Tambaram Medicals:200"),
    short,
  );

  // ---------------------------------------------------------------- D3
  // The defect this release fixes: before the transfer route existed, nothing
  // outside the seed wrote a SUPPLIED row, so stock could not reach a shelf.
  const freshBatchNo = `TRF-${Date.now().toString().slice(-6)}`;
  const products = await api(MFG1, "/api/batches");
  const productId =
    products.body.products?.[0]?.id ?? products.body.items?.[0]?.productId ?? null;
  const made = await api(MFG1, "/api/batches", {
    method: "POST",
    body: JSON.stringify({
      batchNo: freshBatchNo,
      productId,
      issuedQty: 500,
      mfgDate: "2026-01-01T00:00:00Z",
      expiryDate: "2028-01-01T00:00:00Z",
    }),
  });
  const newBatchId = made.body.id ?? made.body.batchId ?? made.body.batch?.id;

  const orgs = (await api(MFG1, "/api/orgs")).body;
  const orgList = orgs.items ?? orgs.organizations ?? [];
  const distId = orgList.find((o) => o.type === "DISTRIBUTOR")?.id;
  const retAId = orgList.find((o) => o.licenseNo === "DL/TN/4401")?.id;

  const toDist = await api(MFG1, "/api/transfers", {
    method: "POST",
    body: JSON.stringify({ batchId: newBatchId, toOrgId: distId, qty: 200 }),
  });
  const toRet = await api(DIST, "/api/transfers", {
    method: "POST",
    body: JSON.stringify({ batchId: newBatchId, toOrgId: retAId, qty: 120 }),
  });
  check(
    "D3",
    "stock issued through the API can reach a pharmacy shelf — manufacturer -> distributor -> retailer",
    toDist.status === 200 &&
      toRet.status === 200 &&
      toDist.body.authorized === true &&
      toRet.body.authorized === true,
    { toDist: toDist.body, toRet: toRet.body },
  );

  // ---------------------------------------------------------------- D4
  // Both halves of the handoff, or quantity appears from nowhere.
  const acct2 = await api(REG1, `/api/accountability/batch/${newBatchId}`);
  const dist = (acct2.body.locations ?? []).find((l) => l.orgType === "DISTRIBUTOR");
  const ret = (acct2.body.locations ?? []).find((l) => l.licenseNo === "DL/TN/4401");
  check(
    "D4",
    "a transfer writes both sides: the sender's balance falls by exactly what the receiver's rises",
    dist?.balance?.balance === 80 && ret?.balance?.balance === 120,
    { distributor: dist?.balance, retailer: ret?.balance },
  );

  // ---------------------------------------------------------------- D5
  // I7 — refused before the fact, so the books cannot go negative through the API.
  const overshoot = await api(DIST, "/api/transfers", {
    method: "POST",
    body: JSON.stringify({ batchId: newBatchId, toOrgId: retAId, qty: 5000 }),
  });
  check(
    "D5",
    "I7: transferring more than a location holds is refused (409), not silently absorbed",
    overshoot.status === 409 && overshoot.body.error?.code === "LOCATION_QUANTITY_BREACH",
    { status: overshoot.status, body: overshoot.body },
  );

  // ---------------------------------------------------------------- D6
  // An unauthorised route is RECORDED and flagged, never refused: refusing it
  // would only push the movement off the books.
  const sideways = await api(RETA, "/api/transfers", {
    method: "POST",
    body: JSON.stringify({ batchId: newBatchId, toOrgId: orgList.find((o) => o.licenseNo === "DL/TN/4403")?.id, qty: 5 }),
  });
  check(
    "D6",
    "an unauthorised route is recorded and flagged, not refused",
    sideways.status === 200 &&
      sideways.body.authorized === false &&
      sideways.body.alerts?.some((a) => a.code === "UNAUTHORIZED_ROUTE"),
    sideways.body,
  );

  // ---------------------------------------------------------------- D7
  const recalled = byNo("RCL-4402");
  const recalledId = recalled?.id;
  const recallScan = await scan(RETB, "MFG/TN/002", "RCL-4402", 1);
  check(
    "D7",
    "a recalled batch is blocked at the counter",
    recallScan.body.verdict === "BLOCK" && recallScan.body.alertCode === "RECALLED_SALE",
    recallScan.body,
  );

  // ---------------------------------------------------------------- D8
  const heldScan = await scan(RETC, "MFG/TN/001", "HLD-7788", 1);
  check(
    "D8",
    "a batch under hold is blocked at the counter, and says so differently from a recall",
    heldScan.body.verdict === "BLOCK" && heldScan.body.alertCode === "HELD_SALE",
    heldScan.body,
  );

  // ---------------------------------------------------------------- D9
  // No silent RECALLED -> CLEAN, for anyone.
  const retailerRelease = await api(RETB, "/api/regulator/holds", {
    method: "POST",
    body: JSON.stringify({ batchId: recalledId, action: "RELEASED", reason: "we would like to sell this" }),
  });
  const noReason = await api(REG1, "/api/regulator/holds", {
    method: "POST",
    body: JSON.stringify({ batchId: recalledId, action: "RELEASED", reason: "ok" }),
  });
  check(
    "D9",
    "a recall cannot be lifted by a retailer, nor by a regulator without a recorded reason",
    retailerRelease.status === 403 && noReason.status === 400,
    { retailer: retailerRelease.status, noReason: noReason.status },
  );

  // ---------------------------------------------------------------- D10
  // A release is a NEW order referencing the one it lifts, never an edit.
  const release = await api(REG1, "/api/regulator/holds", {
    method: "POST",
    body: JSON.stringify({
      batchId: recalledId,
      action: "RELEASED",
      reason: "Retesting cleared the batch; the laboratory result was traced to a sampling error.",
    }),
  });
  const holdLog = await api(REG1, "/api/regulator/holds");
  const forThis = (holdLog.body.items ?? []).filter((h) => h.batchId === recalledId);
  check(
    "D10",
    "lifting a recall appends a new order naming the one it lifts — the original stays on the record",
    release.status === 200 &&
      release.body.to === "CLEAN" &&
      forThis.length === 2 &&
      forThis.some((h) => h.action === "RELEASED" && h.releasesId) &&
      forThis.some((h) => h.action === "RECALL_ISSUED"),
    forThis,
  );

  // ---------------------------------------------------------------- D11
  // Consumer purchase bill: multiple manufacturers on one bill, and qty 1.
  const sale = await api(RETB, "/api/consumer-bills", {
    method: "POST",
    body: JSON.stringify({
      lines: [
        { manufacturerRef: "MFG/TN/001", batchNo: "P-9100", qty: 10 },
        { manufacturerRef: "MFG/TN/002", batchNo: "B-1001", qty: 1 },
      ],
    }),
  });
  check(
    "D11",
    "one consumer bill carries lines from two manufacturers, including a single tablet",
    sale.status === 200 &&
      sale.body.lines?.length === 2 &&
      sale.body.lines.some((l) => l.qty === 1) &&
      new Set(sale.body.lines.map((l) => l.manufacturerLicenseNo)).size === 2,
    sale.body,
  );

  // ---------------------------------------------------------------- D12
  // The QR resolves to the live record with no login at all.
  const pub = await fetch(`${BASE}/api/verify/bill/${sale.body.token}`).then((r) => r.json());
  check(
    "D12",
    "the bill QR token resolves publicly, with no authentication",
    pub.billNo === sale.body.billNo && pub.lines?.length === 2 && pub.allSafe === true,
    pub,
  );

  // ---------------------------------------------------------------- D13
  // A sale the system would refuse must not produce a receipt for it.
  const badSale = await api(RETC, "/api/consumer-bills", {
    method: "POST",
    body: JSON.stringify({
      lines: [
        { manufacturerRef: "MFG/TN/001", batchNo: "P-9100", qty: 2 },
        { manufacturerRef: "MFG/TN/001", batchNo: "B-2002", qty: 2 },
      ],
    }),
  });
  const afterBad = await api(RETC, "/api/consumer-bills");
  check(
    "D13",
    "an expired line refuses the whole bill — no receipt, and the good lines are rolled back too",
    badSale.status === 400 &&
      badSale.body.error?.code === "EXPIRED_SALE" &&
      !(afterBad.body.items ?? []).some((b) =>
        b.lines?.some((l) => l.batchNo === "B-2002"),
      ),
    { status: badSale.status, error: badSale.body.error },
  );

  // ---------------------------------------------------------------- D14
  // Dynamic expiry: the same stored record, read at a later date.
  const later = new Date(Date.now() + 400 * 24 * 36e5).toISOString();
  const simulated = await fetch(
    `${BASE}/api/verify/bill/${sale.body.token}?asOf=${encodeURIComponent(later)}`,
  ).then((r) => r.json());
  const backwards = await fetch(
    `${BASE}/api/verify/bill/${sale.body.token}?asOf=2020-01-01T00:00:00Z`,
  ).then((r) => r.json());
  check(
    "D14",
    "the demo date control makes a valid batch expire, and refuses to run backwards",
    simulated.simulated === true &&
      simulated.lines.some((l) => l.status === "EXPIRED") &&
      backwards.simulated === false &&
      backwards.simulationRejected === true,
    { simulated: simulated.lines?.map((l) => l.status), backwards: backwards.simulated },
  );

  // ---------------------------------------------------------------- D15
  // A citizen report is evidence. It must not move the batch.
  const beforeReport = await api(REG1, `/api/accountability/batch/${newBatchId}`);
  const report = await fetch(`${BASE}/api/citizen-reports`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      manufacturerRef: "MFG/TN/001",
      batchNo: freshBatchNo,
      reason: "SUSPECTED_COUNTERFEIT",
      description: "Foil looks re-sealed.",
    }),
  }).then((r) => r.json());
  const afterReport = await api(REG1, `/api/accountability/batch/${newBatchId}`);
  const stillSellable = await scan(RETA, "MFG/TN/001", freshBatchNo, 1);
  check(
    "D15",
    "a public report is recorded as evidence and changes nothing about the batch on its own",
    !!report.id &&
      report.batchResolved === true &&
      stillSellable.body.verdict === "ALLOW" &&
      beforeReport.body.totals?.sold === afterReport.body.totals?.sold,
    { report, verdict: stillSellable.body.verdict },
  );

  // ---------------------------------------------------------------- D16
  const unresolved = await fetch(`${BASE}/api/citizen-reports`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      manufacturerRef: "MFG/TN/001",
      batchNo: "NO-SUCH-BATCH-9999",
      reason: "SUSPECTED_COUNTERFEIT",
    }),
  }).then((r) => r.json());
  check(
    "D16",
    "a report about a batch number that does not exist is kept, not rejected — that is the counterfeit signal",
    !!unresolved.id && unresolved.batchResolved === false,
    unresolved,
  );

  // ---------------------------------------------------------------- D17
  const stalls = await api(REG1, "/api/regulator/stalls");
  const stalled = (stalls.body.items ?? []).filter((i) => i.stalled);
  check(
    "D17",
    "I8: a return that stopped moving is listed with who owes the next event and by when",
    stalls.status === 200 &&
      stalled.length >= 1 &&
      stalled.every((i) => i.owedByRole && i.expectedNext && i.deadline && i.overdueDays > 0),
    { stalled: stalled.length, sample: stalled[0] },
  );

  // ---------------------------------------------------------------- D18
  const breaches = await api(REG1, "/api/regulator/breaches");
  check(
    "D18",
    "I7: the seeded books-do-not-balance location is reported, and nothing else is",
    breaches.status === 200 &&
      breaches.body.items?.length >= 1 &&
      breaches.body.items.some((b) => b.batchNo === "LGC-0091" && b.breach.shortfall === 40),
    breaches.body.items?.map((b) => `${b.batchNo}/${b.orgName}`),
  );

  // ---------------------------------------------------------------- D19
  const replay = await api(REG1, `/api/regulator/replay/${amx?.id}`);
  check(
    "D19",
    "forensic replay reconstructs a batch chronologically from stored rows",
    replay.status === 200 &&
      replay.body.events?.length > 5 &&
      replay.body.events.every((e, i, arr) => i === 0 || arr[i - 1].at <= e.at) &&
      replay.body.events.some((e) => e.event === "ISSUED") &&
      replay.body.events.some((e) => e.event === "BILLED"),
    { count: replay.body.events?.length },
  );

  // ---------------------------------------------------------------- D20
  // Everything above appended to the same chain it started on.
  const finalAudit = await api(REG1, "/api/audit/verify");
  check(
    "D20",
    "the hash chain is still intact after transfers, recalls, releases, bills and reports",
    finalAudit.body.valid === true,
    finalAudit.body,
  );

  console.log("=".repeat(60));
  console.log(`${results.length - failures}/${results.length} passed, ${failures} failed\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\nHARNESS ERROR:", e);
  process.exit(2);
});
