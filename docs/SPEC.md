# RCCP — Build Spec

**Stack:** Next.js 14 (App Router) · TypeScript · PostgreSQL · Prisma · Tailwind · shadcn/ui
**Auth:** JWT in httpOnly cookie
**Deploy:** Vercel + Neon — do this at hour 2, not hour 15
**Target:** every acceptance item in §9 passing

Working rules for the agent are in `CLAUDE.md` at the repo root. This file is the
detail those rules refer to.

---

## 0. Build order — seven passes

Do not implement this spec in one pass. Work these in order, verifying each before
starting the next.

| Pass | Scope | Verify by |
|---|---|---|
| 1 | `src/lib/invariants.ts` per §3. Pure functions, no DB access. Vitest tests for every invariant including breach cases. Nothing else. | tests pass |
| 2 | `src/lib/lifecycle.ts` per §4 and `src/lib/audit.ts` per §7 | tests pass |
| 3 | Auth + seed per §8 | log in as all six users |
| 4 | API routes per §5 | curl each route |
| 5 | POS scan (§5.6) and `/verify` (§6.6) | acceptance A1, A9–A13 |
| 6 | Role dashboards per §6, one role at a time, starting with RETAILER | click through |
| 7 | Run the §9 checklist, fix failures | all green |

The invariant module and its tests exist before any UI. The invariants are the project;
the screens are a presentation layer over them.

---

## 1. Canonical enums — single source of truth

These appear in `prisma/schema.prisma` and `src/lib/types.ts`. Never invent a variant.

```ts
OrgType         = RETAILER | DISTRIBUTOR | MANUFACTURER | FACILITY | REGULATOR
Role            = RETAILER | DISTRIBUTOR | MANUFACTURER | FACILITY | REGULATOR
RegistryStatus  = CLEAN | IN_RETURN_PIPELINE | DESTROYED | HELD | RECALLED
InventoryStatus = ACTIVE | QUARANTINED | RETURNED
ExpiryState     = NORMAL | EXPIRY_WARNING | RETURN_DUE
ReturnState     = RETURN_DUE | INITIATED | PICKUP_ASSIGNED
                | DISTRIBUTOR_RECEIVED | MANUFACTURER_RECEIVED
                | DISPOSAL_SCHEDULED | FACILITY_RECEIVED | CERTIFIED_DESTROYED
LedgerEvent     = ISSUED | TRANSFERRED | SUPPLIED | BILLED | RETURN_INITIATED
                | RECEIVED | LEAKED | DESTROYED
ScanContext     = SALE | RETURN_INTAKE | VERIFY
ScanVerdict     = ALLOW | BLOCK
Severity        = LOW | MEDIUM | HIGH | CRITICAL
LeakageStatus   = OPEN | ACKNOWLEDGED | WRITTEN_OFF
AlertCode       = UNKNOWN_BATCH | RESURRECTED_BATCH | EXPIRED_SALE
                | IN_PIPELINE_SALE | QUANTITY_BREACH | DOUBLE_RETURN
                | LEAKAGE | WEIGHT_MISMATCH | BACKDATED_INVOICE
                | CERTIFICATE_OVER_ALLOCATION | LOCATION_QUANTITY_BREACH
                | STALLED_IN_PIPELINE | UNAUTHORIZED_ROUTE | RECALLED_SALE
                | HELD_SALE | CITIZEN_REPORT
HoldAction      = HOLD_ISSUED | RECALL_ISSUED | RELEASED
CitizenReportReason
                = SUSPECTED_EXPIRED | SUSPECTED_COUNTERFEIT | PACKAGING_TAMPERED
                | ADVERSE_REACTION | SOLD_AFTER_RECALL | OTHER
```

`src/lib/types.ts` carries a compile-time drift guard for each of these, so this
list, the Prisma schema and the app enums cannot fall out of step without the
build failing. Extending the list is a deliberate act that touches all three
files at once; inventing a variant in one of them is still forbidden.

---

## 2. Prisma schema

### 2.1 Header

```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }

enum OrgType         { RETAILER DISTRIBUTOR MANUFACTURER FACILITY REGULATOR }
enum Role            { RETAILER DISTRIBUTOR MANUFACTURER FACILITY REGULATOR }
enum RegistryStatus  { CLEAN IN_RETURN_PIPELINE DESTROYED }
enum InventoryStatus { ACTIVE QUARANTINED RETURNED }
enum ReturnState     { RETURN_DUE INITIATED PICKUP_ASSIGNED DISTRIBUTOR_RECEIVED
                       MANUFACTURER_RECEIVED DISPOSAL_SCHEDULED FACILITY_RECEIVED
                       CERTIFIED_DESTROYED }
enum LedgerEvent     { ISSUED SUPPLIED BILLED RETURN_INITIATED RECEIVED LEAKED DESTROYED }
enum ScanContext     { SALE RETURN_INTAKE VERIFY }
enum ScanVerdict     { ALLOW BLOCK }
enum Severity        { LOW MEDIUM HIGH CRITICAL }
enum LeakageStatus   { OPEN ACKNOWLEDGED WRITTEN_OFF }
enum AlertCode       { UNKNOWN_BATCH RESURRECTED_BATCH EXPIRED_SALE IN_PIPELINE_SALE
                       QUANTITY_BREACH DOUBLE_RETURN LEAKAGE WEIGHT_MISMATCH
                       BACKDATED_INVOICE CERTIFICATE_OVER_ALLOCATION }
```

### 2.2 Core entities

```prisma
model Organization {
  id                  String   @id @default(cuid())
  name                String
  type                OrgType
  licenseNo           String   @unique
  stateCode           String
  district            String
  mappedDistributorId String?
  mappedDistributor   Organization?  @relation("RetailerDist", fields: [mappedDistributorId], references: [id])
  retailers           Organization[] @relation("RetailerDist")

  users               User[]
  products            Product[]        @relation("MfgProducts")
  batches             Batch[]          @relation("MfgBatches")
  inventory           Inventory[]
  ledger              BatchLedger[]
  returnsAsRetailer   ReturnRequest[]  @relation("RetRet")
  returnsAsDistrib    ReturnRequest[]  @relation("RetDist")
  returnsAsMfg        ReturnRequest[]  @relation("RetMfg")
  createdAt           DateTime @default(now())
}

model User {
  id             String   @id @default(cuid())
  email          String   @unique
  passwordHash   String
  role           Role
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id])
}

model Product {
  id             String   @id @default(cuid())
  name           String            // "Amoxicillin 500mg"
  form           String            // "Capsule"
  manufacturerId String
  manufacturer   Organization @relation("MfgProducts", fields: [manufacturerId], references: [id])
  unitWeightG    Float   @default(0.75)
  batches        Batch[]
}

/// Surrogate id + composite unique. Do NOT use a composite primary key:
/// batch numbers are manufacturer-assigned and collide across manufacturers,
/// so (manufacturerId, batchNo) must be unique — but a composite PK forces
/// every relation to carry both columns and costs an hour in Prisma.
model Batch {
  id             String   @id @default(cuid())
  manufacturerId String
  manufacturer   Organization @relation("MfgBatches", fields: [manufacturerId], references: [id])
  batchNo        String
  productId      String
  product        Product  @relation(fields: [productId], references: [id])
  issuedQty      Int                       // units the manufacturer released — feeds I1
  mfgDate        DateTime
  expiryDate     DateTime
  registryStatus RegistryStatus @default(CLEAN)
  destroyedAt    DateTime?

  inventory      Inventory[]
  ledger         BatchLedger[]
  returns        ReturnRequest[]
  certificates   DestructionCertificate[]
  alerts         Alert[]

  @@unique([manufacturerId, batchNo])
  @@index([expiryDate])
}

model Inventory {
  id       String  @id @default(cuid())
  orgId    String
  org      Organization @relation(fields: [orgId], references: [id])
  batchId  String
  batch    Batch   @relation(fields: [batchId], references: [id])
  qty      Int
  status   InventoryStatus @default(ACTIVE)
  @@unique([orgId, batchId])
}
```

### 2.3 Ledger, returns, leakage, disposal

```prisma
/// APPEND ONLY. Never UPDATE, never DELETE. All balances are SUMs over this table.
/// qtyDelta is always a positive magnitude; the event type carries the direction.
model BatchLedger {
  id        BigInt      @id @default(autoincrement())
  batchId   String
  batch     Batch       @relation(fields: [batchId], references: [id])
  orgId     String
  org       Organization @relation(fields: [orgId], references: [id])
  eventType LedgerEvent
  qtyDelta  Int
  refType   String?
  refId     String?
  serverTs  DateTime    @default(now())

  @@index([batchId, eventType])
  @@index([orgId, batchId, eventType])
}

model ReturnRequest {
  id             String   @id @default(cuid())
  batchId        String
  batch          Batch    @relation(fields: [batchId], references: [id])
  retailerId     String
  retailer       Organization @relation("RetRet",  fields: [retailerId],     references: [id])
  distributorId  String
  distributor    Organization @relation("RetDist", fields: [distributorId],  references: [id])
  manufacturerId String
  manufacturer   Organization @relation("RetMfg",  fields: [manufacturerId], references: [id])

  state          ReturnState @default(RETURN_DUE)
  dueBy          DateTime                 // expiryDate + 30 days

  declaredQty    Int?                     // set at INITIATED by the retailer
  condition      String?
  photoUrl       String?
  initiatedAt    DateTime?

  pickupAt       DateTime?

  distReceivedQty Int?
  distWeightG     Float?
  distPhotoUrl    String?
  distReceivedAt  DateTime?

  mfgReceivedQty  Int?
  mfgReceivedAt   DateTime?

  /// min() of confirmed quantities along the chain. The certificate ceiling
  /// is computed from this, never from declaredQty.
  confirmedQty    Int?

  leakage         LeakageRecord[]
  disposals       DisposalRequest[]
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([state])
  @@index([dueBy])
}

/// Created whenever received < declared. NEVER auto-closed.
/// An OPEN LeakageRecord is the correct end state, not an unfinished feature:
/// units that left a pharmacy and did not arrive are the fraud being detected.
/// Closing them automatically would launder exactly what this system exists to surface.
model LeakageRecord {
  id          String @id @default(cuid())
  returnId    String
  return      ReturnRequest @relation(fields: [returnId], references: [id])
  batchId     String
  fromOrgId   String
  toOrgId     String
  declaredQty Int
  receivedQty Int
  leakedQty   Int
  status      LeakageStatus @default(OPEN)
  note        String?
  createdAt   DateTime @default(now())
  @@index([status])
  @@index([fromOrgId])
}

model DisposalRequest {
  id             String @id @default(cuid())
  returnId       String
  return         ReturnRequest @relation(fields: [returnId], references: [id])
  batchId        String
  manufacturerId String
  facilityId     String
  qty            Int
  scheduledDate  DateTime
  facilityReceivedAt DateTime?
  certificates   DestructionCertificate[]
  createdAt      DateTime @default(now())
}

model DestructionCertificate {
  id                String @id @default(cuid())
  certNo            String @unique
  disposalRequestId String
  disposalRequest   DisposalRequest @relation(fields: [disposalRequestId], references: [id])
  batchId           String
  batch             Batch @relation(fields: [batchId], references: [id])
  facilityId        String
  qty               Int
  issuedAt          DateTime @default(now())
}
```

### 2.4 Scans, alerts, audit, idempotency

```prisma
model PosScan {
  id                 String @id @default(cuid())
  orgId              String
  rawManufacturerRef String            // licence no or org id as presented
  rawBatchNo         String
  batchId            String?           // null => UNKNOWN_BATCH
  qty                Int
  context            ScanContext
  claimedInvoiceDate DateTime?         // client-supplied, NOT authoritative
  verdict            ScanVerdict
  alertCode          AlertCode?
  serverTs           DateTime @default(now())
}

model Alert {
  id               String @id @default(cuid())
  code             AlertCode
  severity         Severity
  batchId          String?
  batch            Batch? @relation(fields: [batchId], references: [id])
  orgId            String?
  payload          Json
  acknowledgedById String?
  acknowledgedAt   DateTime?
  createdAt        DateTime @default(now())
  @@index([severity, createdAt])
}

/// Hash chain proves the digital record was not altered after the fact.
/// It does NOT prove physical destruction occurred. Keep that caveat visible in the UI.
model AuditEvent {
  id          BigInt   @id @default(autoincrement())
  entityType  String
  entityId    String
  action      String
  actorUserId String?
  actorOrgId  String?
  payload     Json
  prevHash    String?
  hash        String
  serverTs    DateTime @default(now())
  @@index([entityType, entityId])
}

model IdempotencyKey {
  key            String   @id
  userId         String
  endpoint       String
  requestHash    String
  responseStatus Int
  responseBody   Json
  createdAt      DateTime @default(now())
}
```

---

## 3. `src/lib/invariants.ts` — build this first

Pure functions. No Prisma calls inside; the caller passes in the sums. Each returns
`{ ok: boolean; code?: AlertCode; severity?: Severity; detail?: object }`.

```ts
// I1 MASS BALANCE — catches a cloned batch number
checkMassBalance({ billedSum, issuedQty, incomingQty })
  ok = billedSum + incomingQty <= issuedQty
  breach -> QUANTITY_BREACH / CRITICAL

// I2 EXISTENCE — catches an invented batch number
checkExistence({ batch })
  ok = batch != null
  breach -> UNKNOWN_BATCH / CRITICAL

// I3 RETURN CONSERVATION — catches the same stock returned twice
checkReturnConservation({ returnInitiatedSum, suppliedSum, requestedQty })
  ok = returnInitiatedSum + requestedQty <= suppliedSum
  breach -> DOUBLE_RETURN / HIGH

// I4 CERTIFICATE CEILING
checkCertificateCeiling({ confirmedQty, alreadyAllocated, requestedQty })
  eligible = confirmedQty - alreadyAllocated
  ok = requestedQty <= eligible
  breach -> CERTIFICATE_OVER_ALLOCATION / HIGH  (HTTP 409)

// I5 TEMPORAL VALIDITY — evaluated independently of registry status,
//    so it covers batches that never entered the return pipeline at all
checkTemporalValidity({ expiryDate, serverNow })
  ok = serverNow <= expiryDate
  breach -> EXPIRED_SALE / HIGH

// I6 HANDOFF CONSERVATION — returns the leak, does not resolve it
computeLeakage({ declaredQty, receivedQty })
  if receivedQty > declaredQty -> reject the handoff outright
  leakedQty = declaredQty - receivedQty        // >= 0
  leakedQty > 0 -> LEAKAGE / HIGH, status OPEN
```

**Why I1 and I2 exist.** A fraudster repackaging expired stock has three options, and
each breaks a different invariant:

```text
reuse the destroyed batch number  -> registryStatus DESTROYED  -> BLOCK
clone a different real batch no.  -> Σ billed > issuedQty      -> I1 CRITICAL
invent a batch number             -> not in registry           -> I2 CRITICAL
```

Tests must cover: each invariant's pass case, each breach case, `receivedQty ===
declaredQty` (zero leakage), partial certificate allocation across two certificates,
and I5 on a batch whose `registryStatus` is `CLEAN`.

---

### I7 LOCATION CONSERVATION

```
Received + Transfers In - Sales - Transfers Out - Returns >= 0
```

Evaluated per `(organisation, batch)` over `BatchLedger`. A negative balance is
`LOCATION_QUANTITY_BREACH` at HIGH.

This is an **accounting inconsistency, not proof of diversion.** The honest
readings include a missed inbound record, a mis-keyed quantity and a genuine
diversion, and nothing in the check distinguishes them. It is a reason to ask a
question, never a finding. `LEAKED` is neutral in this sum: those units were
already counted out by the row that dispatched them.

Every stock movement writes BOTH sides — `TRANSFERRED` against whoever released
the units and `SUPPLIED` (or `RECEIVED`) against whoever took them on. Without
the pair, quantity appears or vanishes at a change of custody and this invariant
has nothing to check.

### I8 STAGE STALL

Per-stage SLA over `ReturnRequest.state` and the server's `updatedAt`. Past the
deadline: `STALLED_IN_PIPELINE`, MEDIUM, escalating to HIGH once overdue by a
full SLA period.

The failure this catches is an **absent** event rather than a refused one. A
return that is accepted, quarantined off the shelf and then never collected trips
none of I1–I6, because nothing happened — and "nothing happened" is precisely the
state a party that does not want stock reconciled would choose.

---

## 4. `src/lib/lifecycle.ts` — the only mutator

```ts
transition(returnId, targetState, actor, payload, tx)
```

- Every return state change goes through this function. No route handler writes `state`
  directly.
- Legal transitions only:
  `RETURN_DUE → INITIATED → PICKUP_ASSIGNED → DISTRIBUTOR_RECEIVED →
  MANUFACTURER_RECEIVED → DISPOSAL_SCHEDULED → FACILITY_RECEIVED → CERTIFIED_DESTROYED`
- Everything runs inside one `prisma.$transaction`. A failed invariant throws and rolls
  back — **no partial writes may survive a rejected certificate.**
- Every transition appends a `BatchLedger` row and an `AuditEvent` row.
- `registryStatus` changes at exactly two points:
  - `INITIATED` → `IN_RETURN_PIPELINE`
  - `CERTIFIED_DESTROYED` **and** `alreadyAllocated === confirmedQty` → `DESTROYED`,
    set `destroyedAt`.
    A partial certificate must **not** flip the batch to `DESTROYED`.
- `confirmedQty = min(declaredQty, distReceivedQty, mfgReceivedQty)`, recomputed at each
  receipt.

### Expiry → return

```text
daysLeft > 60   -> NORMAL
1 … 60          -> EXPIRY_WARNING
<= 0            -> RETURN_DUE, dueBy = expiryDate + 30 days
                   retailer confirms with evidence -> INITIATED
                   -> registryStatus IN_RETURN_PIPELINE
                   -> enforce I3
                   -> inventory status QUARANTINED
```

The system raises `RETURN_DUE`; it never fabricates a return. Evidence (photo,
condition, quantity) is a human act, so `INITIATED` requires a retailer action.

---

## 5. API surface

All routes under `src/app/api/`. Every mutating route accepts an `Idempotency-Key`
header, checks `IdempotencyKey`, and replays the stored response on a repeat.

```
POST   /api/auth/login                        { email, password } -> sets cookie
GET    /api/me

RETAILER
GET    /api/inventory                          list + daysLeft + expiryState
GET    /api/returns/due                        RETURN_DUE items with SLA countdown
POST   /api/returns/:id/initiate               { declaredQty, condition, photoUrl }
                                               enforces I3; inventory -> QUARANTINED
GET    /api/returns                            mine, with state timeline

DISTRIBUTOR
GET    /api/returns/inbound
POST   /api/returns/:id/pickup                 { pickupAt }
POST   /api/returns/:id/receive                { scannedBatchNo, receivedQty, weightG, photoUrl }
                                               batch mismatch      -> 400 reject
                                               received > declared -> 400 reject
                                               received < declared -> LeakageRecord OPEN,
                                                 chain CONTINUES at receivedQty

MANUFACTURER
GET    /api/batches                            issued registry
POST   /api/batches                            { batchNo, productId, issuedQty, mfgDate, expiryDate }
GET    /api/returns/upstream
POST   /api/returns/:id/mfg-receive            { receivedQty }
POST   /api/disposals                          { returnId, facilityId, qty, scheduledDate }

FACILITY
GET    /api/disposals/inbound
POST   /api/disposals/:id/receive
POST   /api/certificates                       { disposalRequestId, qty }
                                               I4 breach -> 409 CERTIFICATE_OVER_ALLOCATION

POS (any retailer)
POST   /api/pos/scan                           see §5.6

PUBLIC (no auth, rate-limited)
GET    /api/verify/:licenseNo/:batchNo

REGULATOR
GET    /api/regulator/alerts?severity=
GET    /api/regulator/leakage                  grouped by org
GET    /api/regulator/overdue-returns          dueBy < now AND state = RETURN_DUE
POST   /api/alerts/:id/acknowledge

GET    /api/audit/verify                       walks the hash chain
```

### 5.6 `POST /api/pos/scan` — the decision function

Request: `{ manufacturerRef, batchNo, qty, context, claimedInvoiceDate? }`

**Evaluate in this exact order. Do not reorder — rule 3 must precede the registry
checks so it covers batches with no return history.**

```
1  batch not found                      -> BLOCK  UNKNOWN_BATCH        CRITICAL
2  registryStatus == DESTROYED          -> BLOCK  RESURRECTED_BATCH    CRITICAL
3  serverNow > expiryDate               -> BLOCK  EXPIRED_SALE         HIGH
4  registryStatus == IN_RETURN_PIPELINE
     context == RETURN_INTAKE           -> ALLOW  (expected path)
     context == SALE                    -> BLOCK  IN_PIPELINE_SALE     HIGH
5  billedSum + qty > issuedQty          -> BLOCK  QUANTITY_BREACH      CRITICAL
6  otherwise                            -> ALLOW, append BILLED to ledger
```

If `claimedInvoiceDate` is more than 24h before `serverTs`, raise `BACKDATED_INVOICE`
at `MEDIUM` alongside the primary verdict. All verdicts use `serverTs`; the claimed
date is evidence only, never an input to the decision.

Response: `{ verdict, alertCode, severity, message, batch }`. Every scan writes a
`PosScan` row whatever the verdict.

---

## 6. Screens

Shared: left nav by role, top bar with org name + licence no, toast on any CRITICAL.

### 6.1 Retailer
- **Inventory** — product, batchNo, manufacturer, qty, expiry, `daysLeft`, state chip
  (grey NORMAL / amber EXPIRY_WARNING / red RETURN_DUE)
- **Returns due** — card per item, SLA countdown from `dueBy`, red when overdue
- **Initiate return modal** — qty, condition, photo upload
- **My returns** — horizontal state timeline
- **POS terminal** — the demo surface. Batch input, manufacturer select, qty,
  `SALE / RETURN_INTAKE` toggle. Verdict renders full-width: green ALLOW, red BLOCK with
  the alert code and message in large type. Make this screen big and legible.

### 6.2 Distributor
- **Inbound returns** queue, assign pickup
- **Receive form** — as qty is typed, show live:
  `Declared 100 · Receiving 70 · 30 units will be recorded as unaccounted`.
  This must not read like an approval step.
- **Leakage ledger** — my open records

### 6.3 Manufacturer
- **Issued batch registry** — register batch + `issuedQty`. Feeds I1; without this
  screen there is no mass balance.
- **Batch health** — per batch: issued / billed / returned / destroyed / unaccounted,
  as a stacked bar
- **Inbound returns**, **disposal requests**, **certificates** with an
  eligible-vs-allocated bar
- **Alerts on my batches**

### 6.4 Facility
- **Inbound disposal requests**, receive confirm
- **Issue certificate** — shows `eligible = confirmedQty − alreadyAllocated` before
  submit. A 409 renders as a red banner quoting both numbers. **Do not disable the
  submit button client-side** — the server rejection is the demo.

### 6.5 Regulator
- **KPI row** — open CRITICAL alerts · unaccounted units · overdue returns · batches destroyed
- **Alerts** table, severity filter, acknowledge action
- **Leakage by organisation** — recurring leakage against one pair is the fraud signal
- **Overdue returns by district**
- **Batch lookup**

### 6.6 Public `/verify/[licenseNo]/[batchNo]`
Mobile-first, no auth, no nav. One large status card:

```
DESTROYED           red     "This batch was destroyed on <date>. Report to <state drug controller>."
IN_RETURN_PIPELINE  amber   "This batch is expired and withdrawn from sale."
expired             amber   "This batch expired on <date>."
CLEAN + in date     green   "Valid."
not found           red     "No record of this batch. Do not consume."
```

Render a QR to this URL on the manufacturer batch screen so it can be scanned off the
laptop with a phone.

---

## 7. `src/lib/audit.ts`

```ts
hash = SHA256(JSON.stringify(payload) + actorUserId + serverTs.toISOString() + (prevHash ?? ""))
```

One global chain. `GET /api/audit/verify` walks it and returns
`{ valid, brokenAtId? }`.

---

## 8. Seed data — must support every demo act

```
ORGS
  MFG-1   Aurex Pharma        MANUFACTURER  MFG/TN/001
  MFG-2   Kelvin Labs         MANUFACTURER  MFG/TN/002
  DIST-1  Chennai Meds        DISTRIBUTOR   DL/TN/210
  RET-A   Anna Nagar Medicals RETAILER      DL/TN/4401  -> DIST-1
  RET-B   Guindy Pharmacy     RETAILER      DL/TN/4402  -> DIST-1
  RET-C   Velachery Chemist   RETAILER      DL/TN/4403  -> DIST-1
  FAC-1   TN Biomedical       FACILITY      BMW/TN/07
  REG-1   TN Drugs Control    REGULATOR     REG/TN

PRODUCTS
  P1  Amoxicillin 500mg  MFG-1   unitWeightG 0.75
  P2  Amoxicillin 500mg  MFG-2   unitWeightG 0.75     <- same drug, different maker

BATCHES
  MFG-1 / B-1001  P1  issued 500  expiry 2026-08-15 (past)   main thread
  MFG-1 / B-2002  P1  issued 300  expiry 2026-08-01 (past)   A1 — never returned
  MFG-1 / B-3003  P1  issued 200  expiry 2027-06-30 (future) A12 — clone target
  MFG-2 / B-1001  P2  issued 400  expiry 2027-03-31 (future) A10 — collision proof

INVENTORY
  RET-A  MFG-1/B-1001  100
  RET-B  MFG-1/B-1001   40
  RET-C  MFG-1/B-2002   60
  RET-C  MFG-1/B-3003   50

LEDGER (pre-seeded)
  ISSUED   for every batch at its issuedQty
  SUPPLIED MFG-1/B-1001 -> RET-A 100, RET-B 40
  SUPPLIED MFG-1/B-2002 -> RET-C 60
  SUPPLIED MFG-1/B-3003 -> RET-C 50
  BILLED   MFG-1/B-3003  195   <- leaves 5 units of headroom, so a scan of 10
                                  breaches I1 (acceptance A12)

USERS  one per org, password "demo1234"
```

---

## 9. Acceptance checklist

```
[ ] A1  RET-C scans MFG-1/B-2002, context SALE
        -> BLOCK / EXPIRED_SALE, registryStatus was CLEAN throughout
[ ] A2  RET-A initiates return of 100 of B-1001
        -> INITIATED, registry IN_RETURN_PIPELINE, inventory QUARANTINED
[ ] A2b RET-A attempts a second return of B-1001
        -> BLOCK / DOUBLE_RETURN (I3)
[ ] A3  DIST-1 receives 70 against declared 100
        -> DISTRIBUTOR_RECEIVED, confirmedQty 70,
           LeakageRecord leakedQty 30 status OPEN,
           regulator "unaccounted units" shows 30
[ ] A4  DIST-1 attempts to receive 110 against 100 -> 400 reject
[ ] A5  MFG-1 receives 70, schedules disposal to FAC-1
[ ] A6  FAC-1 requests certificate for 100 -> 409 CERTIFICATE_OVER_ALLOCATION
        AND no row was written (re-query certificates: still empty)
[ ] A7  FAC-1 requests 40 -> issued; batch still IN_RETURN_PIPELINE (partial)
[ ] A8  FAC-1 requests 30 -> alreadyAllocated == 70 == confirmedQty
        -> registryStatus DESTROYED, destroyedAt set
[ ] A9  RET-B scans MFG-1/B-1001, context SALE
        -> BLOCK / RESURRECTED_BATCH, CRITICAL, alert to MFG-1 and REG-1
[ ] A10 RET-B scans MFG-2/B-1001 -> ALLOW (composite key, no false alert)
[ ] A11 RET-B scans MFG-1/B-9999 -> BLOCK / UNKNOWN_BATCH, CRITICAL
[ ] A12 RET-C scans MFG-1/B-3003 qty 10 -> BLOCK / QUANTITY_BREACH
        (195 billed + 10 > 200 issued)
[ ] A13 /verify/MFG-TN-001/B-1001 on a phone -> red DESTROYED card
[ ] A14 /api/audit/verify -> { valid: true }
[ ] A15 Every mutating route replays correctly on a repeated Idempotency-Key
```

A10 and A11 are the two that answer *"what if they just print a new batch number?"*

---

## 10. Hour budget

| Hours | Work |
|---|---|
| 0.0 – 0.5 | Scaffold, schema, migrate, Neon + Vercel connected |
| 0.5 – 1.5 | `invariants.ts` + tests (pass 1) |
| 1.5 – 2.5 | `lifecycle.ts`, `audit.ts`, seed (passes 2–3) |
| 2.5 – 4.5 | API routes (pass 4) |
| 4.5 – 5.5 | POS scan + `/verify` + QR (pass 5) |
| 5.5 – 8.5 | Role dashboards, one at a time (pass 6) |
| 8.5 – 9.5 | Acceptance checklist, fix failures (pass 7) |
| 9.5 – 11.0 | Slides, limitations rehearsal, two dry runs |

If behind, cut in this order: weight cross-check → manufacturer batch-health bar →
regulator district view → audit verify route. Never cut the invariant tests, `/verify`,
or acceptance items A10 and A11.

---

## 11. Known limits — state these before being asked

1. The CDSCO document is **guidance circulated to state authorities, not statute** — no
   penalty clause, no verification procedure. This is infrastructure for a mandate that
   is coming. Do not say "mandate" unqualified.
2. Common biomedical waste facilities receive by **weight** and incinerate in bulk; they
   do not record batch numbers. Our certificate is an attestation with a quantity ceiling
   enforced against it — a real constraint on over-declaration, not independent proof of
   destruction.
3. India's domestic QR mandate is **batch-level and covers only the ~300 Schedule H2
   brands**; item-level serialisation applies to exports. At scale the binding constraint
   is data entry, not algorithm design.
4. POS blocking binds only participating retailers. Enforcement that does not depend on
   the offender's cooperation sits in distributor outbound invoicing, the public
   `/verify` endpoint, and the regulator's overdue-return list.
5. `issuedQty` is manufacturer-declared. I1 detects clones and over-circulation; it does
   not detect a manufacturer under-declaring its own production.
