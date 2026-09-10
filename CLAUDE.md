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
