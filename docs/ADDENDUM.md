# RCCP — addendum to `docs/SPEC.md`

`docs/SPEC.md` is the original build spec and stops at acceptance item A15. Six
subsystems were added after it was written, and `CLAUDE.md` rules 11–16 govern
them while pointing readers back at a spec that does not describe them. This
file closes that gap.

**`SPEC.md` is not superseded.** §1's enum list, §3's six invariants, §4's
transition graph and §5.6's fixed rule order all still hold exactly as written.
Everything here is additive.

---

## 1. What each module is for

Every module below follows the same boundary rule, stated at the top of each
file: **it holds no business rules and decides nothing.** Any threshold or
comparison belongs in `src/lib/invariants.ts` (CLAUDE.md rule 1).

### `src/lib/billing.ts` — compliance receipts

A `Bill` is a permanent regulatory record of one decision: was this stock OK or
EXPIRED at the moment someone acted on it, and why. It is generated **from** an
invariant outcome and can never influence one.

It carries no price, amount or currency, and never will. It is created and never
updated or deleted by any code path; a correction is a **new** `Bill` and a new
`AuditEvent`. There is no override for an EXPIRED receipt, for any role, in the
UI or on any route.

### `src/lib/cdsco.ts` — external reference data

Read-only lookups over CDSCO Not-of-Standard-Quality alerts and the licensed
entity register. `scripts/import-cdsco.mjs` is the only writer.

CDSCO status and RCCP's own receipt answer **different questions** and are never
merged into one status. A batch can be clean in this chain's ledger and still be
CDSCO-flagged on quality, or the reverse. `/verify` reports them side by side.

`NsqAlert` is keyed on `(medicineName, batchNo)`, not `batchNo` alone —
deliberately, because batch numbers collide across manufacturers (rule 6), and a
`batchNo`-only key would let one maker's recall silently overwrite another's.

### `src/lib/transfer.ts` — stock movement between organisations

The module that lets stock enter the system through anything other than the seed
script.

Every transfer writes **both** sides in one transaction: `TRANSFERRED` against
whoever released the units, `SUPPLIED` against whoever took them on, both
carrying the same `Transfer` id as `refId`. Without the pair, quantity appears or
vanishes at a change of custody and I7 has nothing to check.

An unauthorised route is **recorded and flagged, never refused** — refusing it
would only push the movement off the books, which is the opposite of what a
ledger is for. A transfer that would drive the sender's balance negative *is*
refused (409), before anything is written.

### `src/lib/accountability.ts` — per-location quantity reads

Pure aggregation over the append-only ledger, answering the regulatory question:
of the units issued, how many were sold, how many remain, how many came back, and
where the gap is. Nothing here writes, and nothing here decides — a breach is
reported by `invariants.ts`, not detected here.

### `src/lib/consumer.ts` — the public-facing layer

Backs `/verify/bill/[token]`, which requires **no login** (a consumer checking
their own medicine must never be asked to create an account first). There is no
`CONSUMER` role in the system, because there is nothing to authenticate.

The QR on a purchase receipt carries an **opaque token, not the data**, so it
resolves against the live record. A batch recalled after the sale turns the same
printed receipt red without the paper changing.

### Hold and recall

A regulator's emergency action on a batch. `Batch.registryStatus` gains `HELD`
and `RECALLED`, set **only** by `lifecycle.issueHoldOrRecall` (rule 2), only by a
REGULATOR, and only with a recorded reason of at least 8 characters.

A release is a **new** `HoldRecallOrder` naming the order it lifts — never an
edit or a deletion. `RECALLED -> CLEAN` therefore cannot happen without an actor,
a reason and an audit hash.

Holds and recalls apply only to a `CLEAN` (or, for recall, `HELD`) batch.
`IN_RETURN_PIPELINE` and `DESTROYED` are excluded by design: both already
withdraw the batch from sale more strongly, and `registryStatus` holds one value,
so writing `RECALLED` over `IN_RETURN_PIPELINE` would destroy the record that a
return is in flight.

---

## 2. Invariants added after SPEC §3

### I7 — LOCATION CONSERVATION

```
Received + Transfers In - Sales - Transfers Out - Returns >= 0
```

Per `(organisation, batch)`. Negative ⇒ `LOCATION_QUANTITY_BREACH`, HIGH.

An **accounting inconsistency, not proof of diversion.** A missed inbound record,
a mis-keyed quantity and a genuine diversion look identical to it. It is
deliberately *not* in `billing.ts`'s `BLOCKING` set: it condemns a set of books,
not a batch of medicine.

`LEAKED` is **neutral** in this sum. Those units were already counted out by the
row that dispatched them; counting the leak as a second departure would drive
every leaking retailer negative for books that are in fact square.

### I8 — STAGE STALL

Per-stage SLA over `ReturnRequest.state` and the server's `updatedAt`. Past the
deadline: `STALLED_IN_PIPELINE`, MEDIUM, escalating to HIGH once overdue by a
full SLA period.

The failure this catches is an **absent** event rather than a refused one. A
return that is accepted, quarantined off the shelf and then never collected trips
none of I1–I6, because nothing happened — and "nothing happened" is exactly the
state a party that does not want stock reconciled would choose.

---

## 3. Enum and state additions

All of these are mirrored in `prisma/schema.prisma`, `src/lib/types.ts` and
`docs/SPEC.md` §1, and `types.ts` carries a compile-time drift guard for each, so
the three cannot fall out of step without the build failing.

| Enum | Added | Notes |
|---|---|---|
| `RegistryStatus` | `HELD`, `RECALLED` | Regulator-imposed; only `lifecycle.ts` writes them |
| `LedgerEvent` | `TRANSFERRED` | The outbound half of every handoff |
| `AlertCode` | `LOCATION_QUANTITY_BREACH`, `STALLED_IN_PIPELINE`, `UNAUTHORIZED_ROUTE`, `RECALLED_SALE`, `HELD_SALE`, `CITIZEN_REPORT` | Only the last two `*_SALE` codes are blocking |
| `HoldAction` | `HOLD_ISSUED`, `RECALL_ISSUED`, `RELEASED` | Append-only; `RELEASED` always names the order it lifts |
| `CitizenReportReason` | `SUSPECTED_EXPIRED`, `SUSPECTED_COUNTERFEIT`, `PACKAGING_TAMPERED`, `ADVERSE_REACTION`, `SOLD_AFTER_RECALL`, `OTHER` | |
| `BillStatus` | `OK`, `EXPIRED` | The compliance receipt's only two states |

**`ConsumerStatus`** (`VALID`, `EXPIRED`, `RECALLED`, `HELD`, `DESTROYED`,
`UNKNOWN`) is **not** a Prisma enum and is never stored. It is derived at read
time from registry status and the server clock, in the same order the POS
terminal uses — a consumer scanning a pack and a pharmacist scanning the same
pack must never be told different things about it.

### New models

`Transfer`, `AuthorizedRoute`, `HoldRecallOrder`, `ConsumerBill`,
`ConsumerBillLine`, `CitizenReport`, plus `Bill`, `NsqAlert` and
`LicensedEntity` from the billing/CDSCO pass.

`ConsumerBill` and `Bill` are **different records answering different questions**
and are never merged or substituted:

| | Answers |
|---|---|
| `Bill` | Is this stock OK or EXPIRED, and why — the permanent regulatory record |
| `ConsumerBill` | What a person actually bought, so they can check it later |

A `CitizenReport` is **evidence, never a finding.** It writes no ledger row and
mutates no batch. A system where a stranger's form submission could condemn a
manufacturer's batch would be trivially weaponised. A report naming a batch that
resolves to nothing is kept with `batchId` null — rejecting it for failing to
match would discard exactly the counterfeit signal it raises.

---

## 4. Acceptance coverage

`scripts/acceptance.mjs` runs **49 items** over HTTP against a running server:
A0–A15 and B1–B7 and C1–C5 from the original spec, plus D1–D20 for the
subsystems above. The four checks most often asked about are already there:

| Check | Item |
|---|---|
| A hold blocks a sale | **D8** |
| A recall blocks a sale | **D7** |
| A release requires a reason (and a regulator) | **D9** |
| The consumer date control is forward-only | **D14** |

Also covered: both sides of a transfer (D3, D4), I7 refusing an overdraw (D5),
an unauthorised route recorded rather than refused (D6), a release appending a
new order rather than editing the old one (D10), multi-manufacturer and
single-tablet consumer bills (D11), public token resolution with no auth (D12),
one bad line rolling back a whole sale (D13), citizen reports as evidence (D15,
D16), I8 stalls (D17), the I7 sweep (D18), forensic replay (D19), and the hash
chain surviving all of it (D20).

```bash
npx prisma db seed && npm run build && npm start   # then, in another shell:
node scripts/acceptance.mjs
```

### Unit coverage

161 tests across 8 files. `invariants.ts`, `billing.ts`, `cdsco.ts`,
`accountability.ts` (I7/I8), `transfer.ts`, `consumer.ts`, `audit.ts`,
`lifecycle.ts` and `scripts/check-env.mjs` all have a matching `*.test.ts`. Per
CLAUDE.md style, invariant tests are mandatory and UI tests are not.

---

## 5. Limits these subsystems do not remove

State these before being asked. They sit alongside `SPEC.md` §11, which still
applies in full.

1. **I7 reports an inconsistency, not diversion.** Stock destroyed locally
   without being recorded is indistinguishable from stock diverted. An
   unaccounted figure is a question to put to a pharmacy, not a verdict.
2. **I8 says nobody acted, not why.** A genuine logistics delay and a deliberate
   one look identical to it.
3. **A citizen report is evidence.** It is not corroborated, and nothing
   downstream treats it as proof.
4. **The consumer page shows what was recorded**, and the batch's status right
   now. It can say nothing about medicine nobody recorded.
5. **`AuthorizedRoute` is not a licence.** An entity can hold a valid CDSCO
   licence and still not be an authorised route for a given maker's stock. The
   two are kept separate so a valid licence cannot launder an unexplained
   movement.
