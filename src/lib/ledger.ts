// Balance reads over the append-only BatchLedger (CLAUDE.md rule 4).
// Nothing here writes; every sum an invariant needs comes from this module so
// the aggregation shape is defined once.

import type { Tx } from "./db";
import { LedgerEvent } from "./types";

async function sum(
  tx: Tx,
  where: { batchId: string; eventType: LedgerEvent; orgId?: string },
): Promise<number> {
  const r = await tx.batchLedger.aggregate({ _sum: { qtyDelta: true }, where });
  return r._sum.qtyDelta ?? 0;
}

/** Total units ever billed against a batch, across all retailers. Feeds I1. */
export function billedSum(tx: Tx, batchId: string): Promise<number> {
  return sum(tx, { batchId, eventType: LedgerEvent.BILLED });
}

/**
 * Units supplied to ONE org. Feeds I3.
 *
 * Scoping matters: a global supplied sum would let one retailer's return consume
 * headroom created by another retailer's supply, which is exactly the double-return
 * the invariant exists to catch.
 */
export function suppliedSum(tx: Tx, orgId: string, batchId: string): Promise<number> {
  return sum(tx, { batchId, orgId, eventType: LedgerEvent.SUPPLIED });
}

/** Units ONE org has already put into the return pipeline. Feeds I3. */
export function returnInitiatedSum(tx: Tx, orgId: string, batchId: string): Promise<number> {
  return sum(tx, { batchId, orgId, eventType: LedgerEvent.RETURN_INITIATED });
}

export function destroyedSum(tx: Tx, batchId: string): Promise<number> {
  return sum(tx, { batchId, eventType: LedgerEvent.DESTROYED });
}

export function leakedSum(tx: Tx, batchId: string): Promise<number> {
  return sum(tx, { batchId, eventType: LedgerEvent.LEAKED });
}

export function issuedSum(tx: Tx, batchId: string): Promise<number> {
  return sum(tx, { batchId, eventType: LedgerEvent.ISSUED });
}

/** Units certified destroyed for a batch. The I4 `alreadyAllocated` term. */
export async function allocatedForBatch(tx: Tx, batchId: string): Promise<number> {
  const r = await tx.destructionCertificate.aggregate({ _sum: { qty: true }, where: { batchId } });
  return r._sum.qty ?? 0;
}

/** Per-batch rollup for the manufacturer batch-health bar (SPEC §6.3). */
export async function batchHealth(
  tx: Tx,
  batch: { id: string; issuedQty: number },
): Promise<{
  issued: number;
  billed: number;
  returned: number;
  destroyed: number;
  leaked: number;
  unaccounted: number;
}> {
  const [billed, returned, destroyed, leaked] = await Promise.all([
    billedSum(tx, batch.id),
    sum(tx, { batchId: batch.id, eventType: LedgerEvent.RETURN_INITIATED }),
    destroyedSum(tx, batch.id),
    leakedSum(tx, batch.id),
  ]);
  return {
    issued: batch.issuedQty,
    billed,
    returned,
    destroyed,
    leaked,
    // Units that entered the return pipeline and have neither been certified
    // destroyed nor accounted for as leakage.
    unaccounted: Math.max(0, returned - destroyed - leaked),
  };
}
