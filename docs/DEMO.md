# Demo runbook

Reseed first — the script assumes the opening state.

```bash
npx prisma db seed && npm run dev
```

Every account's password is `demo1234`.

## Act 1 — expired stock is refused at the counter (A1)

Sign in as **Velachery Chemist** (`retc@velachery.example`). POS terminal:
Aurex Pharma / `B-2002` / qty 1 / SALE.

> BLOCK · EXPIRED_SALE

Point out that this batch's registry status is `CLEAN`. It never entered the
return pipeline — nobody ever returned it. The expiry rule is evaluated before
the registry rules precisely so that stock which quietly expired on a shelf is
still caught.

## Act 2 — the return, and the units that go missing (A2, A2b, A4, A3)

**Anna Nagar Medicals** (`reta@annanagar.example`) → Returns due → initiate 100
of `B-1001`. The batch moves to `IN_RETURN_PIPELINE` and the retailer's stock is
quarantined.

Try to initiate it again: refused. Then, as **Velachery Chemist**, try to return
61 units of `B-2002` when only 60 were ever supplied: `DOUBLE_RETURN`. You cannot
return stock you were never sent.

**Chennai Meds** (`dist1@chennaimeds.example`) → assign pickup → Receive. Type
110 first: rejected, you cannot receive more than was declared. Then type 70 and
read the line that appears:

> Declared 100 · Receiving 70 · **30 units will be recorded as unaccounted**

Record it. Thirty units left a pharmacy and did not arrive. That record opens and
stays open — this is the fraud the system exists to surface, so nothing here
closes it.

## Act 3 — the destruction ceiling (A5, A6, A7, A8)

**Aurex Pharma** (`mfg1@aurex.example`) receives 70 and schedules disposal to
TN Biomedical.

**TN Biomedical** (`fac1@tnbiomedical.example`) confirms receipt, then requests a
certificate for **100** units. The submit button is deliberately live:

> 409 · CERTIFICATE_OVER_ALLOCATION · eligible 70, requested 100

Nothing was written. The ceiling comes from the quantity actually confirmed along
the chain, never from what the retailer declared. Issue 40 — the batch stays
`IN_RETURN_PIPELINE`, because a partial certificate must not close a batch. Issue
the remaining 30 and the batch flips to `DESTROYED`.

## Act 4 — what happens when it comes back (A9, A10, A11, A12)

**Guindy Pharmacy** (`retb@guindy.example`) scans Aurex / `B-1001`:

> BLOCK · RESURRECTED_BATCH · CRITICAL

This is the whole point. Those units were certified destroyed; anything bearing
that number is counterfeit or diverted.

Now the two questions an examiner always asks.

*"What if they just use a different manufacturer's number?"* Scan Kelvin Labs /
`B-1001` — the same batch number, a different maker. **ALLOW**, no alert. Batches
are keyed on (manufacturer, batch number), so a collision is not a false positive.

*"What if they print a number that doesn't exist?"* Scan Aurex / `B-9999`:
**UNKNOWN_BATCH, CRITICAL**. Unknown is never treated as clean — an invented
batch number *is* the fraud.

*"What if they clone a real, in-date number?"* Scan Aurex / `B-3003` qty 10.
195 units of a 200-unit batch are already billed:

> BLOCK · QUANTITY_BREACH · CRITICAL

More units are in circulation than were ever issued. The arithmetic catches the
clone without anyone having to spot the packaging.

## Act 5 — the regulator's view (A13, A14)

**TN Drugs Control** (`reg1@tndrugscontrol.example`): open critical alerts, 30
unaccounted units, the leakage pair, the audit chain reporting intact.

Then take out a phone and scan the QR on the Aurex batch registry screen — or
open `/verify/MFG-TN-001/B-1001` directly. A red card, no login. Scan
`/verify/MFG-TN-002/B-1001` next: green. Same batch number, different
manufacturer, opposite answer, on a public endpoint that does not depend on the
offender cooperating.

## Say the limits before you are asked

Read them off `README.md`. The two that matter most: the CDSCO document is
guidance, not statute, so this is infrastructure for a mandate that is coming;
and waste facilities incinerate by weight, so the certificate is an attestation
with an enforced ceiling, not proof of destruction.

---

# Part two — accountability, recall, and the consumer

The acts above prove the chain refuses bad stock. These prove it can say where
good stock went, and give the person holding the medicine a way to check it.

Reseed before running these: `npx prisma db seed`.

## Act 7 — where did the units go? (D1, D2)

**TN Drugs Control** (`reg1@tndrugscontrol.example`) → **Quantity
accountability** → `AMX-25081`.

```
Issued            10,000
Sold to patients   8,000
Never sold         2,000   <- had to come back for destruction
Collected back     1,700
Unaccounted          300
```

Scroll to *Where the units are*. The 300 is not a total floating free of anyone:
**Adyar Health Mart owes 100 and Tambaram Medicals owes 200.** Every figure is a
SUM over the append-only ledger — nobody types them in, and there is no field
anywhere to edit them.

Say the limitation out loud before a judge asks: stock destroyed locally without
being recorded looks identical to stock diverted. This is a question to put to
the pharmacy, not a finding against it.

## Act 8 — the books that do not balance (D18)

→ **Books not balancing**. Tambaram Medicals has sold 140 units of `LGC-0091`
having only ever received 100.

I7 catches it, and the caveat matters: the most common cause is an inbound record
that was never captured, not diversion. It is HIGH severity because it needs an
answer, and it is deliberately *not* a blocking finding.

## Act 9 — stock that stopped moving (D17)

→ **Stalled returns**. `STL-5150` has sat at `INITIATED` for 21 days against a
3-day SLA, and the screen names who owes the next event.

The point worth making: nothing was refused here. None of I1–I6 fired, because
nothing *happened* — and "nothing happened" is exactly the state a party that does
not want stock reconciled would choose.

## Act 10 — the recall (D7, D8, D9, D10)

→ **Holds + recalls**. `RCL-4402` is already recalled and `HLD-7788` held.

1. Sign in as **Guindy Pharmacy** (`retb@guindy.example`) → POS terminal →
   Kelvin Labs / `RCL-4402` → **BLOCK · RECALLED_SALE**.
2. Try `HLD-7788` at Velachery: blocked too, with a different message — a hold is
   an investigation, not a finding.
3. Back as the regulator, try to release the recall with the reason "ok": refused.
   A recall may only be lifted with a written reason, by a regulator, and the
   release is a **new order naming the one it lifts**. The original never leaves
   the record. There is no path from `RECALLED` to `CLEAN` that nobody signed.

## Act 11 — the consumer (D11–D14)

Open `/verify/bill/demo-recalled-bill-token-002` on a phone. No login.

> **RECALLED — DO NOT USE**
> Stop taking it and return it to the pharmacy.

The receipt was issued *before* the recall and has not been reprinted. The QR
carries an opaque token, not the data — so it resolves to the live record, and
the answer changed underneath the paper. That is the whole argument for a token.

Now open `/verify/bill/demo-valid-bill-token-0001`: **VALID**, two medicines from
two different manufacturers, one of them a single tablet.

Press **+1 year**. The same stored record now reads **EXPIRED — DO NOT USE**, and
the page says plainly that it is a demonstration and that nothing was changed.

The control is forward-only. It can make a verdict stricter and never laxer, so
no crafted URL can show expired stock as safe.

## Act 12 — issue a receipt live (D11, D13)

**Guindy Pharmacy** → **Dispense + receipt**:

| Manufacturer | Batch | Qty |
|---|---|---|
| `MFG/TN/001` | `P-9100` | 10 |
| `MFG/TN/002` | `B-1001` | 1 |

A receipt with a QR appears. Scan it off the screen.

Now add a third line for `B-2002` (expired) and dispense again: **the whole sale
is refused**, and the two good lines are rolled back with it. A receipt for
medicine the system would not sell would be worse than no receipt at all.

Note there is no price anywhere on it. RCCP is not a billing system.

## Act 13 — the report, and what it is not (D15, D16)

On the public page, press **Report this medicine**, pick a reason, send. Then, as
the regulator → **Public reports**.

Two things to say:

- The report changes **nothing** about the batch. It is evidence for the regulator
  to weigh; a system where a stranger's form could condemn a manufacturer's batch
  would be trivially weaponised.
- The second seeded report names `B-9999`, which appears on no register at all.
  That report is kept *deliberately* — rejecting it for failing to match would
  discard exactly the counterfeit signal it raises.

## Act 14 — forensic replay (D19, D20)

→ **Forensic replay** → `AMX-25081`. Every recorded event in order, each one read
from a stored row: ledger movements, alerts, receipts, holds, reports.

Close on `/api/audit/verify` → `{ valid: true }`, and on the limitation: this
proves the digital record was not altered after the fact. It does not prove what
physically happened to stock nobody recorded.


---

## Printing the consumer QR codes

The QR on a purchase receipt is normally shown on screen — on **Dispense +
receipt** right after a sale, and on **Customer receipts** for any past one. For
a printed handout, a slide, or a phone that cannot reach your laptop, render them
as PNGs:

```bash
# against the deployment, so a phone can actually open them
node scripts/bill-qr.mjs --base https://<your-app>.vercel.app
```

Three seeded receipts cover the three answers a consumer can get:

| Receipt | Scanning it shows |
|---|---|
| `RCCP-20260908-001` | **VALID** — two manufacturers on one bill, one a single tablet |
| `RCCP-20260909-002` | **RECALLED — DO NOT USE** |
| `RCCP-20260714-003` | **EXPIRED — DO NOT USE** |

The middle one is the demo: the receipt was issued *before* the recall and has
not been reprinted. The paper did not change; the answer did. That is the whole
argument for putting a token in the QR rather than the data.
