// docs/SPEC.md §3 — the six invariants.
//
// Pure functions. No Prisma calls here; the caller passes in the sums.
// CLAUDE.md rule 1: business rules live here and nowhere else. A route handler
// that re-implements one of these checks inline is a bug, not a shortcut.

import { AlertCode, Severity, ExpiryState } from "./types";

export interface InvariantResult {
  ok: boolean;
  code?: AlertCode;
  severity?: Severity;
  detail?: Record<string, unknown>;
}

const OK: InvariantResult = { ok: true };

/**
 * I1 MASS BALANCE — catches a cloned batch number.
 *
 * Total units ever billed against a batch, plus the units this operation wants
 * to add, may never exceed what the manufacturer says it released. A fraudster
 * who reprints a real batch number pushes the sum past `issuedQty`.
 *
 * `incomingQty` is the quantity of the operation being evaluated (a POS scan's
 * qty), not a running total — the running total is `billedSum`.
 */
export function checkMassBalance(input: {
  billedSum: number;
  issuedQty: number;
  incomingQty: number;
}): InvariantResult {
  const { billedSum, issuedQty, incomingQty } = input;
  const projected = billedSum + incomingQty;
  if (projected <= issuedQty) return OK;
  return {
    ok: false,
    code: AlertCode.QUANTITY_BREACH,
    severity: Severity.CRITICAL,
    detail: { billedSum, incomingQty, projected, issuedQty, excess: projected - issuedQty },
  };
}

/**
 * I2 EXISTENCE — catches an invented batch number.
 *
 * CLAUDE.md rule 7: unknown is never treated as clean. A batch number that does
 * not resolve against (manufacturerId, batchNo) is CRITICAL, because inventing a
 * batch number is itself the fraud.
 */
export function checkExistence(input: { batch: unknown | null | undefined }): InvariantResult {
  if (input.batch !== null && input.batch !== undefined) return OK;
  return {
    ok: false,
    code: AlertCode.UNKNOWN_BATCH,
    severity: Severity.CRITICAL,
    detail: { reason: "batch did not resolve against (manufacturerId, batchNo)" },
  };
}

/**
 * I3 RETURN CONSERVATION — catches the same stock returned twice.
 *
 * A retailer cannot return more of a batch than it was ever supplied. Both sums
 * must be scoped to the same (org, batch) pair: a global sum would let one
 * retailer consume another's supply headroom.
 */
export function checkReturnConservation(input: {
  returnInitiatedSum: number;
  suppliedSum: number;
  requestedQty: number;
}): InvariantResult {
  const { returnInitiatedSum, suppliedSum, requestedQty } = input;
  const projected = returnInitiatedSum + requestedQty;
  if (projected <= suppliedSum) return OK;
  return {
    ok: false,
    code: AlertCode.DOUBLE_RETURN,
    severity: Severity.HIGH,
    detail: {
      returnInitiatedSum,
      requestedQty,
      projected,
      suppliedSum,
      excess: projected - suppliedSum,
    },
  };
}

/**
 * I4 CERTIFICATE CEILING.
 *
 * Destruction certificates are capped by `confirmedQty` — the min() of quantities
 * actually confirmed along the chain — never by what the retailer declared.
 * A breach is HTTP 409 and must leave no row behind (see lifecycle.ts).
 */
export function checkCertificateCeiling(input: {
  confirmedQty: number;
  alreadyAllocated: number;
  requestedQty: number;
}): InvariantResult {
  const { confirmedQty, alreadyAllocated, requestedQty } = input;
  const eligible = confirmedQty - alreadyAllocated;
  if (requestedQty <= eligible) return OK;
  return {
    ok: false,
    code: AlertCode.CERTIFICATE_OVER_ALLOCATION,
    severity: Severity.HIGH,
    detail: { confirmedQty, alreadyAllocated, eligible, requestedQty, excess: requestedQty - eligible },
  };
}

/**
 * I5 TEMPORAL VALIDITY.
 *
 * Evaluated independently of registry status, so it covers batches that never
 * entered the return pipeline at all — acceptance A1 is exactly this case.
 * CLAUDE.md rule 5: `serverNow` is the server clock, never a client-supplied date.
 */
export function checkTemporalValidity(input: {
  expiryDate: Date;
  serverNow: Date;
}): InvariantResult {
  const { expiryDate, serverNow } = input;
  if (serverNow.getTime() <= expiryDate.getTime()) return OK;
  return {
    ok: false,
    code: AlertCode.EXPIRED_SALE,
    severity: Severity.HIGH,
    detail: {
      expiryDate: expiryDate.toISOString(),
      serverNow: serverNow.toISOString(),
      daysExpired: Math.floor((serverNow.getTime() - expiryDate.getTime()) / DAY_MS),
    },
  };
}

export interface LeakageResult extends InvariantResult {
  leakedQty: number;
  /** Set when receivedQty > declaredQty: the handoff is rejected outright. */
  rejected: boolean;
}

/**
 * I6 HANDOFF CONSERVATION — returns the leak, does not resolve it.
 *
 * CLAUDE.md rule 8: a shortfall creates an OPEN LeakageRecord and the chain
 * CONTINUES at receivedQty. This function never closes anything, and no caller
 * may treat a positive leakedQty as an approval step.
 */
export function computeLeakage(input: {
  declaredQty: number;
  receivedQty: number;
}): LeakageResult {
  const { declaredQty, receivedQty } = input;

  // Receiving more than was declared is not leakage — it is an impossible
  // handoff, and the correct response is to refuse it (spec §5 -> 400).
  if (receivedQty > declaredQty) {
    return {
      ok: false,
      rejected: true,
      leakedQty: 0,
      code: AlertCode.QUANTITY_BREACH,
      severity: Severity.CRITICAL,
      detail: { declaredQty, receivedQty, reason: "receivedQty exceeds declaredQty" },
    };
  }

  const leakedQty = declaredQty - receivedQty;
  if (leakedQty === 0) return { ok: true, rejected: false, leakedQty: 0 };

  return {
    ok: false,
    rejected: false,
    leakedQty,
    code: AlertCode.LEAKAGE,
    severity: Severity.HIGH,
    detail: { declaredQty, receivedQty, leakedQty },
  };
}

// ---------------------------------------------------------------------------
// Expiry helpers — docs/SPEC.md §4 "Expiry → return"
// ---------------------------------------------------------------------------

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days from serverNow to expiryDate. Negative once expired. */
export function daysLeft(expiryDate: Date, serverNow: Date): number {
  return Math.floor((expiryDate.getTime() - serverNow.getTime()) / DAY_MS);
}

/**
 *   daysLeft > 60 -> NORMAL
 *   1 … 60        -> EXPIRY_WARNING
 *   <= 0          -> RETURN_DUE
 */
export function expiryStateFor(expiryDate: Date, serverNow: Date): ExpiryState {
  const d = daysLeft(expiryDate, serverNow);
  if (d > 60) return ExpiryState.NORMAL;
  if (d >= 1) return ExpiryState.EXPIRY_WARNING;
  return ExpiryState.RETURN_DUE;
}

/** SLA deadline for a return: expiryDate + 30 days. */
export function returnDueBy(expiryDate: Date): Date {
  return new Date(expiryDate.getTime() + 30 * DAY_MS);
}

/**
 * A claimed invoice date more than 24h before the server timestamp is evidence
 * of backdating. It is raised ALONGSIDE the primary verdict and is never an
 * input to it (CLAUDE.md rule 5).
 */
export function checkBackdatedInvoice(input: {
  claimedInvoiceDate: Date | null | undefined;
  serverTs: Date;
}): InvariantResult {
  const { claimedInvoiceDate, serverTs } = input;
  if (!claimedInvoiceDate) return OK;
  const skewMs = serverTs.getTime() - claimedInvoiceDate.getTime();
  if (skewMs <= DAY_MS) return OK;
  return {
    ok: false,
    code: AlertCode.BACKDATED_INVOICE,
    severity: Severity.MEDIUM,
    detail: {
      claimedInvoiceDate: claimedInvoiceDate.toISOString(),
      serverTs: serverTs.toISOString(),
      hoursBackdated: Math.floor(skewMs / (60 * 60 * 1000)),
    },
  };
}

/**
 * Weight cross-check at distributor intake. Advisory only: it raises an alert,
 * it never blocks a handoff. Physical weighing is noisy — packaging, moisture,
 * part-blisters — so the tolerance is deliberately wide.
 */
export function checkWeightPlausibility(input: {
  receivedQty: number;
  unitWeightG: number;
  observedWeightG: number | null | undefined;
  tolerance?: number;
}): InvariantResult {
  const { receivedQty, unitWeightG, observedWeightG } = input;
  const tolerance = input.tolerance ?? 0.25;
  if (observedWeightG === null || observedWeightG === undefined) return OK;
  const expected = receivedQty * unitWeightG;
  if (expected <= 0) return OK;
  const deviation = Math.abs(observedWeightG - expected) / expected;
  if (deviation <= tolerance) return OK;
  return {
    ok: false,
    code: AlertCode.WEIGHT_MISMATCH,
    severity: Severity.MEDIUM,
    detail: {
      receivedQty,
      unitWeightG,
      expectedWeightG: Number(expected.toFixed(3)),
      observedWeightG,
      deviationPct: Number((deviation * 100).toFixed(1)),
      tolerancePct: tolerance * 100,
    },
  };
}
