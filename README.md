# RCCP — Pharma Reverse Chain Compliance Platform

Tracks expired medicines from retail shelf to verified destruction across
retailer → distributor → manufacturer → biomedical waste facility, with
batch-level quantity conservation and re-entry fraud detection.

Working rules for contributors: [`CLAUDE.md`](./CLAUDE.md).
Full specification: [`docs/SPEC.md`](./docs/SPEC.md).

## The idea in one paragraph

A pharmacy's expired stock is worth money to whoever will repackage it. Once it
leaves the shelf, nothing in the current paper process can tell you whether it
was incinerated or resold. RCCP makes every handoff a quantity claim measured
against an append-only ledger, so the three ways of putting expired stock back
into circulation each break a different arithmetic invariant:

| What a fraudster does | What breaks |
|---|---|
| Reuse a destroyed batch number | registry status is `DESTROYED` → BLOCK |
| Clone a different real batch number | Σ billed > issued → **I1** CRITICAL |
| Invent a batch number | not in the registry → **I2** CRITICAL |

## Running it

Requires Node 20+ and a PostgreSQL database.

```bash
npm install
cp .env.example .env          # set DATABASE_URL and a 32+ char JWT_SECRET
npx prisma migrate deploy     # or `npx prisma migrate dev` when iterating
npx prisma db seed
npm run dev                   # http://localhost:3000
```

Every seeded account uses the password `demo1234`. Sign in as
`reta@annanagar.example` (retailer) to land on the POS terminal.

```bash
npm run test        # invariant, lifecycle and audit-chain unit tests
npm run typecheck   # tsc --noEmit, strict
node scripts/acceptance.mjs   # the whole §9 checklist, over HTTP
```

`scripts/acceptance.mjs` drives a running server and mutates the database, so
reseed before each run:

```bash
npx prisma db seed && node scripts/acceptance.mjs
```

## Architecture

```
src/lib/invariants.ts   the six invariants, pure functions, no DB access
src/lib/lifecycle.ts    the ONLY module that mutates return state / registry status
src/lib/pos.ts          the §5.6 decision function, fixed rule order
src/lib/ledger.ts       every balance the invariants read, as SUMs over BatchLedger
src/lib/audit.ts        the global hash chain and its verification walk
src/app/api/            route handlers: validate, authorise, call into the above
src/app/(app)/          role dashboards
src/app/verify/         the public, unauthenticated batch lookup
```

Four rules hold everywhere, and breaking any of them is a bug rather than a
shortcut:

1. Business rules live in `invariants.ts`. A route that re-implements a check
   inline will drift from the tests that cover it.
2. Only `lifecycle.ts` writes `ReturnRequest.state` or `Batch.registryStatus`.
3. Every mutation is one transaction that appends an `AuditEvent`, and a
   quantity movement also appends a `BatchLedger` row. A failed invariant throws
   and rolls the whole thing back — which is why a rejected certificate leaves
   no row behind.
4. `BatchLedger` is append-only. Balances are always SUMs over it.

## Deploying

The app is deployment-ready for Vercel + Neon with no code changes:

1. Create a Neon database and copy its pooled connection string.
2. Import the repository into Vercel.
3. Set `DATABASE_URL`, `JWT_SECRET` (32+ characters) and `NEXT_PUBLIC_BASE_URL`.
4. The build script runs `prisma generate` before `next build`. Run
   `npx prisma migrate deploy` and `npx prisma db seed` against the Neon URL once.

The public `/verify` rate limiter is a per-process in-memory bucket. It survives
neither a redeploy nor multiple serverless instances; a real deployment puts that
check at the edge.

## Known limits — state these before being asked

1. The CDSCO document is **guidance circulated to state authorities, not
   statute** — no penalty clause, no verification procedure. This is
   infrastructure for a mandate that is coming. Do not say "mandate" unqualified.
2. Common biomedical waste facilities receive by **weight** and incinerate in
   bulk; they do not record batch numbers. The certificate here is an
   attestation with an enforced quantity ceiling — a real constraint on
   over-declaration, not independent proof of destruction.
3. India's domestic QR mandate is **batch-level and covers only the ~300
   Schedule H2 brands**; item-level serialisation applies to exports. At scale
   the binding constraint is data entry, not algorithm design.
4. POS blocking binds only participating retailers. Enforcement that does not
   depend on the offender's cooperation sits in distributor outbound invoicing,
   the public `/verify` endpoint, and the regulator's overdue-return list.
5. `issuedQty` is manufacturer-declared. I1 detects clones and over-circulation;
   it does not detect a manufacturer under-declaring its own production.
6. The audit chain proves the digital record was not altered after the fact. It
   does not prove that physical destruction occurred.
7. The chain tip is read and appended inside a transaction but without a
   serialisable isolation level or an advisory lock, so two genuinely concurrent
   appends could in principle read the same predecessor. At demo concurrency this
   does not arise; under load it needs one of those two mechanisms.
