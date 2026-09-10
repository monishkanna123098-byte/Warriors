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
