# RCCP — Pharma Reverse Chain Compliance Platform

Tracks expired medicines from retail shelf to verified destruction across retailer →
distributor → manufacturer → biomedical waste facility, with batch-level quantity
conservation and re-entry fraud detection.

**Full spec: `docs/SPEC.md`.** Read the relevant section before writing code.

## Stack

Next.js 14 (App Router) · TypeScript strict · PostgreSQL · Prisma · Tailwind · shadcn/ui
JWT in an httpOnly cookie. Vitest for tests.

```bash
npm run dev
npx prisma migrate dev
npx prisma db seed
npm run test
```

## Non-negotiable rules

1. `src/lib/invariants.ts` holds all six invariants as pure functions. Business rules
   live there and nowhere else. Never duplicate a check inside a route handler.
2. `src/lib/lifecycle.ts` is the only module that mutates `ReturnRequest.state` or
   `Batch.registryStatus`. Route handlers call it; they never write those fields.
3. Every mutating operation runs inside one `prisma.$transaction` and appends both a
   `BatchLedger` row and an `AuditEvent` row. A failed invariant throws and rolls back.
4. `BatchLedger` is append-only. Never UPDATE or DELETE a ledger row.
5. All time comparisons use the server clock. Client-supplied dates are evidence,
   never inputs to a verdict.
6. Batches are identified by `(manufacturerId, batchNo)`. A bare `batchNo` is never
   sufficient to resolve a batch — batch numbers collide across manufacturers.
7. A batch that cannot be resolved is `CRITICAL / UNKNOWN_BATCH`. Unknown is never
   treated as clean. This is deliberate: an invented batch number is the fraud.
8. Missing units are never closed by an approval. `receivedQty < declaredQty` creates a
   `LeakageRecord` with status `OPEN` and the chain continues at `receivedQty`.
   **A LeakageRecord that is never auto-closed is correct, not an unfinished feature.**
   Do not "fix" it by resolving it automatically.
9. The POS decision order in `docs/SPEC.md` §5.6 is fixed. Do not reorder it. Rule 3
   (expiry) must precede the registry checks so it covers batches that never entered
   the return pipeline.
10. Do not add: blockchain, ML or anomaly models, OCR, WebSockets, a message queue, or
    any auth provider beyond the JWT cookie. If a task seems to need one, stop and ask.
11. `src/lib/billing.ts` holds the compliance-receipt logic. Bill records are generated
    from invariant/lifecycle outcomes, are permanent, and never decide or override them.
    A Bill is created and never updated or deleted, by any code path, ever — a correction
    is a new Bill and a new `AuditEvent`, never a mutation of the original. There is no
    override for an EXPIRED receipt, for any role, in the UI or on any route.
12. `src/lib/cdsco.ts` is a read-only reference layer over externally imported CDSCO data.
    It never writes to `Bill`, `ReturnRequest`, `Batch` or `BatchLedger`, and it never
    changes how `invariants.ts` decides anything. CDSCO NSQ status and this system's own
    OK/EXPIRED receipt answer different questions and are never merged into one status.

## Architecture

```
src/lib/invariants.ts   the six invariants, pure, no DB access — the only place rules live
src/lib/lifecycle.ts    the ONLY mutator of ReturnRequest.state / Batch.registryStatus
src/lib/pos.ts          the §5.6 decision function, fixed rule order
src/lib/billing.ts      compliance receipts, pure — reads an outcome, never decides one
src/lib/cdsco.ts        CDSCO reference lookups, pure, read-only external ground truth
src/lib/ledger.ts       every balance the invariants read, as SUMs over BatchLedger
src/lib/audit.ts        the global hash chain and its verification walk
scripts/import-cdsco.mjs  the only writer to NsqAlert / LicensedEntity
```

## Style

- TypeScript strict. No `any`.
- Zod-validate every request body at the route boundary.
- Errors return `{ error: { code, message, detail } }` where `code` is an `AlertCode`.
- Invariant tests are mandatory. UI tests are not.
- Never invent an enum variant. The canonical list is `docs/SPEC.md` §1.

## Scope discipline

This is a 24-hour build. If asked to implement something not in `docs/SPEC.md`, say so
before writing it. Prefer finishing an acceptance item in §9 over improving one that
already passes.
