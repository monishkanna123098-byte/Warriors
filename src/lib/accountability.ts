// Quantity accountability — the reads behind the regulator's central question:
//
//   Of the units originally issued in a batch, how many were distributed, sold,
//   remain in stock, were returned after expiry, received, destroyed, or remain
//   unaccounted for — and where did the discrepancy occur?
//
// This module holds NO rules. Every verdict comes from invariants.ts
// (CLAUDE.md rule 1); everything here is aggregation and shaping. If a threshold
// or a comparison starts creeping in below, it belongs in invariants.ts.
//
// Nothing here writes. All of it is SUMs over the append-only BatchLedger.

import type { Tx } from "./db";
import {
  checkLocationBalance,
  expectedExpiredReturn,
  locationBalance,
  type LocationBalance,
} from "./invariants";
import { eventSumsByOrg } from "./ledger";
import { AlertCode, LedgerEvent, OrgType, Severity } from "./types";

export interface LocationAccount {
  orgId: string;
  orgName: string;
  orgType: OrgType;
  licenseNo: string;
  district: string;
  balance: LocationBalance;
  /** Units this location received one way or another. */
  received: number;
  /** Units sold to patients here. */
  sold: number;
  /** Units sent onward — transfers plus returns initiated. */
  sentOn: number;
  /** Still held here, per the ledger. */
  onHand: number;
  /** Of what was never sold, how much must be disposed of. */
  expectedExpiredReturn: number;
  /** Of that, how much has actually entered the return pipeline. */
  collected: number;
  /** The gap that stays open. */
  unaccounted: number;
  /** Set when the derived balance went negative (I7). */
  breach: { code: AlertCode; severity: Severity; shortfall: number } | null;
}

export interface BatchAccount {
  batchId: string;
  batchNo: string;
  manufacturer: string;
  manufacturerLicenseNo: string;
  product: string;
  issuedQty: number;
  expiryDate: string;
  expired: boolean;
  /** Rolled up across every location. */
  totals: {
    issued: number;
    sold: number;
    returned: number;
    received: number;
    destroyed: number;
    leaked: number;
    outstanding: number;
    expectedExpiredReturn: number;
    collected: number;
    unaccounted: number;
  };
  locations: LocationAccount[];
  breaches: number;
}

const sumOf = (s: Partial<Record<LedgerEvent, number>>, e: LedgerEvent) => s[e] ?? 0;

/**
 * Per-location accounting for one batch.
 *
 * `serverNow` decides only whether the batch is past expiry — the quantities
 * themselves are timeless facts of the ledger. CLAUDE.md rule 5: it is the
 * server clock, never a date the caller supplied.
 */
export async function batchAccount(
  tx: Tx,
  batchId: string,
  serverNow: Date,
): Promise<BatchAccount | null> {
  const batch = await tx.batch.findUnique({
    where: { id: batchId },
    include: { manufacturer: true, product: true },
  });
  if (!batch) return null;

  const byOrg = await eventSumsByOrg(tx, batchId);
  const orgIds = [...byOrg.keys()];
  const orgs = await tx.organization.findMany({ where: { id: { in: orgIds } } });
  const orgById = new Map(orgs.map((o) => [o.id, o]));

  const locations: LocationAccount[] = [];
  for (const [orgId, sums] of byOrg) {
    const org = orgById.get(orgId);
    if (!org) continue;

    const verdict = checkLocationBalance({ sums, orgId, batchId });
    const expiry = expectedExpiredReturn({ sums });

    locations.push({
      orgId,
      orgName: org.name,
      orgType: org.type as OrgType,
      licenseNo: org.licenseNo,
      district: org.district,
      balance: verdict.balance,
      received:
        sumOf(sums, LedgerEvent.SUPPLIED) +
        sumOf(sums, LedgerEvent.RECEIVED) +
        sumOf(sums, LedgerEvent.ISSUED),
      sold: sumOf(sums, LedgerEvent.BILLED),
      sentOn: sumOf(sums, LedgerEvent.TRANSFERRED) + sumOf(sums, LedgerEvent.RETURN_INITIATED),
      onHand: expiry.onHand,
      expectedExpiredReturn: expiry.expected,
      collected: expiry.collected,
      unaccounted: expiry.unaccounted,
      breach:
        verdict.ok || !verdict.code
          ? null
          : {
              code: verdict.code,
              severity: verdict.severity ?? Severity.HIGH,
              shortfall: -verdict.balance.balance,
            },
    });
  }

  // Retail locations are the only ones with a disposal obligation: a distributor
  // or facility holding stock mid-pipeline has not failed to return anything, it
  // IS the return. Rolling their balances into "expected" would double-count the
  // same units the retailer already sent.
  const retail = locations.filter((l) => l.orgType === OrgType.RETAILER);
  const all = [...byOrg.values()];
  const total = (e: LedgerEvent) => all.reduce((n, s) => n + sumOf(s, e), 0);

  const sold = total(LedgerEvent.BILLED);
  const returned = total(LedgerEvent.RETURN_INITIATED);
  const destroyed = total(LedgerEvent.DESTROYED);
  const expected = retail.reduce((n, l) => n + l.expectedExpiredReturn, 0);
  const collected = retail.reduce((n, l) => n + l.collected, 0);

  return {
    batchId,
    batchNo: batch.batchNo,
    manufacturer: batch.manufacturer.name,
    manufacturerLicenseNo: batch.manufacturer.licenseNo,
    product: batch.product.name,
    issuedQty: batch.issuedQty,
    expiryDate: batch.expiryDate.toISOString(),
    expired: serverNow.getTime() > batch.expiryDate.getTime(),
    totals: {
      issued: batch.issuedQty,
      sold,
      returned,
      received: total(LedgerEvent.RECEIVED),
      destroyed,
      leaked: total(LedgerEvent.LEAKED),
      // Units released that were never sold to a patient. This is the figure
      // the disposal obligation is measured against; what has since been
      // collected is `collected`, and the gap is `unaccounted`. Do not net the
      // returns off here — that produces a third number nobody asked for and
      // makes "2,000 outstanding, 1,700 collected, 300 missing" stop adding up.
      outstanding: Math.max(0, batch.issuedQty - sold),
      expectedExpiredReturn: expected,
      collected,
      unaccounted: retail.reduce((n, l) => n + l.unaccounted, 0),
    },
    locations: locations.sort((a, b) => b.received - a.received),
    breaches: locations.filter((l) => l.breach).length,
  };
}

/** Every location's balance for one organisation, across all batches it touched. */
export async function orgAccount(tx: Tx, orgId: string, serverNow: Date) {
  const touched = await tx.batchLedger.groupBy({ by: ["batchId"], where: { orgId } });
  const out = [];
  for (const { batchId } of touched) {
    const account = await batchAccount(tx, batchId, serverNow);
    if (!account) continue;
    const mine = account.locations.find((l) => l.orgId === orgId);
    if (mine) out.push({ batch: { ...account, locations: [] }, location: mine });
  }
  return out;
}

/**
 * Sweep for I7 breaches across every batch a set of orgs has touched.
 * Read-only: it reports inconsistencies, it never writes an Alert row. Whether a
 * finding becomes an alert is the caller's decision, not this module's.
 */
export async function locationBreaches(tx: Tx, serverNow: Date) {
  const batches = await tx.batch.findMany({ select: { id: true } });
  const found = [];
  for (const { id } of batches) {
    const account = await batchAccount(tx, id, serverNow);
    if (!account) continue;
    for (const l of account.locations) {
      if (l.breach) {
        found.push({
          batchId: account.batchId,
          batchNo: account.batchNo,
          manufacturer: account.manufacturer,
          product: account.product,
          ...l,
        });
      }
    }
  }
  return found;
}

export { locationBalance };
