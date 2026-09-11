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

/**
 * Every event sum for one (org, batch) pair, in a single grouped query.
 *
 * One groupBy rather than seven aggregates: I7 is evaluated per organisation per
 * batch, so a per-event round trip turns a regulator's batch page into N*7
 * queries. Absent events are simply missing from the result, which is what
 * `locationBalance` expects.
 */
export async function eventSums(
  tx: Tx,
  where: { batchId: string; orgId?: string },
): Promise<Partial<Record<LedgerEvent, number>>> {
  const rows = await tx.batchLedger.groupBy({
    by: ["eventType"],
    where,
    _sum: { qtyDelta: true },
  });
  const out: Partial<Record<LedgerEvent, number>> = {};
  for (const r of rows) out[r.eventType as LedgerEvent] = r._sum.qtyDelta ?? 0;
  return out;
}

/** The same, for every organisation that has touched a batch. Feeds the I7 sweep. */
export async function eventSumsByOrg(
  tx: Tx,
  batchId: string,
): Promise<Map<string, Partial<Record<LedgerEvent, number>>>> {
  const rows = await tx.batchLedger.groupBy({
    by: ["orgId", "eventType"],
    where: { batchId },
    _sum: { qtyDelta: true },
  });
  const out = new Map<string, Partial<Record<LedgerEvent, number>>>();
  for (const r of rows) {
    const sums = out.get(r.orgId) ?? {};
    sums[r.eventType as LedgerEvent] = r._sum.qtyDelta ?? 0;
    out.set(r.orgId, sums);
  }
  return out;
}

/** Units an org has sent onward in transfers. The I7 "Transfers Out" term. */
export function transferredSum(tx: Tx, orgId: string, batchId: string): Promise<number> {
  return sum(tx, { batchId, orgId, eventType: LedgerEvent.TRANSFERRED });
}

/**
 * Every event sum for one organisation, grouped by batch, in a single query.
 *
 * The per-batch alternative is one round trip per batch, which turns a dispatch
 * picker listing a manufacturer's whole register into N queries before the page
 * can render a dropdown.
 */
export async function eventSumsByBatch(
  tx: Tx,
  orgId: string,
): Promise<Map<string, Partial<Record<LedgerEvent, number>>>> {
  const rows = await tx.batchLedger.groupBy({
    by: ["batchId", "eventType"],
    where: { orgId },
    _sum: { qtyDelta: true },
  });
  const out = new Map<string, Partial<Record<LedgerEvent, number>>>();
  for (const r of rows) {
    const sums = out.get(r.batchId) ?? {};
    sums[r.eventType as LedgerEvent] = r._sum.qtyDelta ?? 0;
    out.set(r.batchId, sums);
  }
  return out;
}
