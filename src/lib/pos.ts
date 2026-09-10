// docs/SPEC.md §5.6 — the decision function.
//
// The rule order is FIXED (CLAUDE.md rule 9). Rule 3 (expiry) precedes the
// registry checks so it covers batches that never entered the return pipeline —
// acceptance A1 is exactly that case, and reordering silently breaks it.

import type { Tx } from "./db";
import {
  checkBackdatedInvoice,
  checkExistence,
  checkMassBalance,
  checkTemporalValidity,
} from "./invariants";
import { billedSum } from "./ledger";
import { licenseCandidates } from "./license";
import {
  AlertCode,
  LedgerEvent,
  RegistryStatus,
  ScanContext,
  ScanVerdict,
  Severity,
} from "./types";

export interface ScanRequest {
  /** Licence number or organisation id, as the terminal presented it. */
  manufacturerRef: string;
  batchNo: string;
  qty: number;
  context: ScanContext;
  claimedInvoiceDate?: Date | null;
}

export interface ScanDecision {
  verdict: ScanVerdict;
  alertCode: AlertCode | null;
  severity: Severity | null;
  message: string;
  batch: {
    id: string;
    batchNo: string;
    manufacturer: string;
    manufacturerLicenseNo: string;
    product: string;
    issuedQty: number;
    billedSum: number;
    expiryDate: string;
    registryStatus: RegistryStatus;
    destroyedAt: string | null;
  } | null;
  /** Raised alongside the primary verdict, never as an input to it. */
  secondaryAlerts: { code: AlertCode; severity: Severity; detail?: Record<string, unknown> }[];
  detail?: Record<string, unknown>;
}

/**
 * Resolves a batch from (manufacturerRef, batchNo).
 *
 * CLAUDE.md rule 6: a bare batchNo is never sufficient — batch numbers collide
 * across manufacturers, which is what acceptance A10 proves. The ref may be an
 * organisation id, a literal licence number, or its URL slug.
 */
export async function resolveBatch(tx: Tx, manufacturerRef: string, batchNo: string) {
  const ref = manufacturerRef.trim();
  const manufacturer = await tx.organization.findFirst({
    where: {
      type: "MANUFACTURER",
      OR: [{ id: ref }, { licenseNo: { in: licenseCandidates(ref) } }, { licenseNo: ref }],
    },
  });
  if (!manufacturer) return null;

  return tx.batch.findUnique({
    where: {
      manufacturerId_batchNo: {
        manufacturerId: manufacturer.id,
        batchNo: batchNo.trim().toUpperCase(),
      },
    },
    include: { manufacturer: true, product: true },
  });
}

/**
 * Evaluates a scan and, on an allowed SALE, appends the BILLED ledger row.
 *
 * Must be called inside a transaction: the mass-balance read and the BILLED write
 * have to be atomic, or two concurrent terminals both see headroom that only one
 * of them can have.
 */
export async function decideScan(
  tx: Tx,
  orgId: string,
  req: ScanRequest,
  serverTs: Date,
): Promise<ScanDecision> {
  const batch = await resolveBatch(tx, req.manufacturerRef, req.batchNo);

  const secondaryAlerts: ScanDecision["secondaryAlerts"] = [];
  const backdated = checkBackdatedInvoice({
    claimedInvoiceDate: req.claimedInvoiceDate ?? null,
    serverTs,
  });
  if (!backdated.ok && backdated.code) {
    secondaryAlerts.push({
      code: backdated.code,
      severity: backdated.severity ?? Severity.MEDIUM,
      detail: backdated.detail,
    });
  }

  // --- Rule 1: existence (I2) --------------------------------------------
  const existence = checkExistence({ batch });
  if (!existence.ok || !batch) {
    return {
      verdict: ScanVerdict.BLOCK,
      alertCode: AlertCode.UNKNOWN_BATCH,
      severity: Severity.CRITICAL,
      message: `No batch ${req.batchNo} is registered to ${req.manufacturerRef}. Do not dispense.`,
      batch: null,
      secondaryAlerts,
      detail: { manufacturerRef: req.manufacturerRef, batchNo: req.batchNo },
    };
  }

  const billed = await billedSum(tx, batch.id);
  const view: NonNullable<ScanDecision["batch"]> = {
    id: batch.id,
    batchNo: batch.batchNo,
    manufacturer: batch.manufacturer.name,
    manufacturerLicenseNo: batch.manufacturer.licenseNo,
    product: batch.product.name,
    issuedQty: batch.issuedQty,
    billedSum: billed,
    expiryDate: batch.expiryDate.toISOString(),
    registryStatus: batch.registryStatus as RegistryStatus,
    destroyedAt: batch.destroyedAt?.toISOString() ?? null,
  };

  // --- Rule 2: resurrected batch -----------------------------------------
  if (batch.registryStatus === RegistryStatus.DESTROYED) {
    return {
      verdict: ScanVerdict.BLOCK,
      alertCode: AlertCode.RESURRECTED_BATCH,
      severity: Severity.CRITICAL,
      message: `This batch was certified destroyed on ${batch.destroyedAt?.toISOString().slice(0, 10)}. Stock bearing this number is counterfeit or diverted.`,
      batch: view,
      secondaryAlerts,
      detail: { destroyedAt: batch.destroyedAt?.toISOString() ?? null },
    };
  }

  // --- Rule 3: temporal validity (I5) ------------------------------------
  // Deliberately BEFORE the pipeline check: a batch that expired on the shelf
  // and was never returned has registryStatus CLEAN, so a registry-first order
  // would wave it straight through.
  const temporal = checkTemporalValidity({ expiryDate: batch.expiryDate, serverNow: serverTs });
  if (!temporal.ok) {
    return {
      verdict: ScanVerdict.BLOCK,
      alertCode: AlertCode.EXPIRED_SALE,
      severity: Severity.HIGH,
      message: `This batch expired on ${batch.expiryDate.toISOString().slice(0, 10)}. It must be returned, not sold.`,
      batch: view,
      secondaryAlerts,
      detail: temporal.detail,
    };
  }

  // --- Rule 4: in the return pipeline ------------------------------------
  if (batch.registryStatus === RegistryStatus.IN_RETURN_PIPELINE) {
    if (req.context === ScanContext.RETURN_INTAKE) {
      return {
        verdict: ScanVerdict.ALLOW,
        alertCode: null,
        severity: null,
        message: "Accepted as return intake. This batch is withdrawn from sale.",
        batch: view,
        secondaryAlerts,
      };
    }
    return {
      verdict: ScanVerdict.BLOCK,
      alertCode: AlertCode.IN_PIPELINE_SALE,
      severity: Severity.HIGH,
      message: "This batch is in the return pipeline and withdrawn from sale.",
      batch: view,
      secondaryAlerts,
      detail: { registryStatus: batch.registryStatus },
    };
  }

  // --- Rule 5: mass balance (I1) -----------------------------------------
  const mass = checkMassBalance({
    billedSum: billed,
    issuedQty: batch.issuedQty,
    incomingQty: req.qty,
  });
  if (!mass.ok) {
    return {
      verdict: ScanVerdict.BLOCK,
      alertCode: AlertCode.QUANTITY_BREACH,
      severity: Severity.CRITICAL,
      message: `More units of this batch are in circulation than were ever issued (${billed} billed + ${req.qty} requested against ${batch.issuedQty} issued). This batch number has been cloned.`,
      batch: view,
      secondaryAlerts,
      detail: mass.detail,
    };
  }

  // --- Rule 6: allow ------------------------------------------------------
  // Only a SALE bills. A RETURN_INTAKE already returned at rule 4, and a VERIFY
  // is a lookup — billing it would consume real mass-balance headroom and let a
  // caller exhaust a batch's ceiling just by asking about it.
  if (req.context === ScanContext.SALE) {
    await tx.batchLedger.create({
      data: {
        batchId: batch.id,
        orgId,
        eventType: LedgerEvent.BILLED,
        qtyDelta: req.qty,
        refType: "PosScan",
      },
    });
    view.billedSum = billed + req.qty;
  }

  return {
    verdict: ScanVerdict.ALLOW,
    alertCode: null,
    severity: null,
    message: "Valid. Batch is in date and within its issued quantity.",
    batch: view,
    secondaryAlerts,
  };
}
