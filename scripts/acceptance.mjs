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
      kpi.body.unaccountedUnits === 30,
    {
      to: a3.body.to,
      confirmedQty: a3.body.confirmedQty,
      unaccounted: kpi.body.unaccountedUnits,
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
  const dr = inbound.body.items?.[0];
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

  console.log("=".repeat(60));
  console.log(`${results.length - failures}/${results.length} passed, ${failures} failed\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\nHARNESS ERROR:", e);
  process.exit(2);
});
