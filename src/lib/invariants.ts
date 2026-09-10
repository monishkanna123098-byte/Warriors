// docs/SPEC.md §3 — the six invariants.
//
// Pure functions. No Prisma calls here; the caller passes in the sums.
// CLAUDE.md rule 1: business rules live here and nowhere else. A route handler
// that re-implements one of these checks inline is a bug, not a shortcut.

import { AlertCode, Severity, ExpiryState } from "./types";
import type { LedgerEvent, ReturnState } from "./types";

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

// ---------------------------------------------------------------------------
// I7 LOCATION CONSERVATION
// ---------------------------------------------------------------------------

/**
 * The direction each ledger event moves stock **for the organisation the row is
 * written against**. This is the whole of the balance rule; keeping it as data
 * rather than a chain of ifs means a new LedgerEvent variant is a compile error
 * here rather than a silently mis-counted balance.
 *
 * LEAKED is deliberately NEUTRAL. A shortfall row is written against the party
 * that *declared* the units, and those units were already counted out by the
 * RETURN_INITIATED (or TRANSFERRED) row that dispatched them. Counting LEAKED as
 * a second departure would drive every leaking retailer's balance negative and
 * report an I7 breach for stock the ledger has correctly accounted for — the
 * leak is an annotation on units already gone, not another exit.
 */
export const LEDGER_DIRECTION: Readonly<Record<LedgerEvent, "IN" | "OUT" | "NEUTRAL">> = {
  ISSUED: "IN",
  SUPPLIED: "IN",
  RECEIVED: "IN",
  TRANSFERRED: "OUT",
  BILLED: "OUT",
  RETURN_INITIATED: "OUT",
  DESTROYED: "OUT",
  LEAKED: "NEUTRAL",
};

export interface LocationBalance {
  inbound: number;
  outbound: number;
  balance: number;
  byEvent: Record<string, number>;
}

/** Folds a set of (eventType, qty) sums into one location's balance. */
export function locationBalance(sums: Partial<Record<LedgerEvent, number>>): LocationBalance {
  let inbound = 0;
  let outbound = 0;
  const byEvent: Record<string, number> = {};
  for (const [event, qty] of Object.entries(sums) as [LedgerEvent, number | undefined][]) {
    const n = qty ?? 0;
    if (n === 0) continue;
    byEvent[event] = n;
    const dir = LEDGER_DIRECTION[event];
    if (dir === "IN") inbound += n;
    else if (dir === "OUT") outbound += n;
  }
  return { inbound, outbound, balance: inbound - outbound, byEvent };
}

/**
 * I7 LOCATION CONSERVATION — an organisation cannot ship, sell or return more
 * units of a batch than ever reached it.
 *
 *   Received + Transfers In - Sales - Transfers Out - Returns >= 0
 *
 * A negative balance is an ACCOUNTING INCONSISTENCY, not proof of fraud. The
 * honest readings include a missed inbound record, a mis-keyed quantity and a
 * genuine diversion, and this function cannot tell them apart. Severity is HIGH
 * so it is investigated, and the code is deliberately not in billing.ts's
 * BLOCKING set: it condemns a set of books, not a batch of medicine.
 */
export function checkLocationBalance(input: {
  sums: Partial<Record<LedgerEvent, number>>;
  orgId?: string;
  batchId?: string;
}): InvariantResult & { balance: LocationBalance } {
  const balance = locationBalance(input.sums);
  if (balance.balance >= 0) return { ok: true, balance };
  return {
    ok: false,
    balance,
    code: AlertCode.LOCATION_QUANTITY_BREACH,
    severity: Severity.HIGH,
    detail: {
      orgId: input.orgId,
      batchId: input.batchId,
      inbound: balance.inbound,
      outbound: balance.outbound,
      balance: balance.balance,
      shortfall: -balance.balance,
      byEvent: balance.byEvent,
    },
  };
}

/**
 * EXPECTED EXPIRED RETURN — of what reached this location, how much should be
 * coming back rather than having been sold.
 *
 * This is a QUANTITY REQUIRING DISPOSITION, not an incident. A pharmacy holding
 * 200 unsold units of an expired batch has done nothing wrong; it has an
 * obligation. Only the gap that survives collection is an accountability issue,
 * and `unaccounted` below is the number that stays open.
 */
export function expectedExpiredReturn(input: {
  sums: Partial<Record<LedgerEvent, number>>;
}): { onHand: number; expected: number; collected: number; unaccounted: number } {
  const { sums } = input;
  const balance = locationBalance(sums);
  const collected = sums.RETURN_INITIATED ?? 0;
  // What is still on the shelf plus what has already been sent back: the full
  // quantity that was never sold to a patient and therefore must be disposed of.
  const expected = Math.max(0, balance.balance) + collected;
  return {
    onHand: Math.max(0, balance.balance),
    expected,
    collected,
    unaccounted: Math.max(0, expected - collected),
  };
}

// ---------------------------------------------------------------------------
// I8 STAGE STALL
// ---------------------------------------------------------------------------

/**
 * Days a return may sit at each stage before the next event is overdue, and who
 * owes that event.
 *
 * CERTIFIED_DESTROYED is terminal and can never stall — the absence of an entry
 * is the rule, not an omission.
 */
export const STAGE_SLA: Readonly<
  Record<
    Exclude<ReturnState, "CERTIFIED_DESTROYED">,
    { days: number; owedBy: "RETAILER" | "DISTRIBUTOR" | "MANUFACTURER" | "FACILITY"; next: ReturnState }
  >
> = {
  RETURN_DUE: { days: 7, owedBy: "RETAILER", next: "INITIATED" },
  INITIATED: { days: 3, owedBy: "DISTRIBUTOR", next: "PICKUP_ASSIGNED" },
  PICKUP_ASSIGNED: { days: 5, owedBy: "DISTRIBUTOR", next: "DISTRIBUTOR_RECEIVED" },
  DISTRIBUTOR_RECEIVED: { days: 10, owedBy: "DISTRIBUTOR", next: "MANUFACTURER_RECEIVED" },
  MANUFACTURER_RECEIVED: { days: 7, owedBy: "MANUFACTURER", next: "DISPOSAL_SCHEDULED" },
  DISPOSAL_SCHEDULED: { days: 14, owedBy: "FACILITY", next: "FACILITY_RECEIVED" },
  FACILITY_RECEIVED: { days: 7, owedBy: "FACILITY", next: "CERTIFIED_DESTROYED" },
};

export interface StallResult extends InvariantResult {
  stalled: boolean;
  state: ReturnState;
  elapsedDays: number;
  slaDays: number;
  overdueDays: number;
  deadline: Date | null;
  owedBy: string | null;
  expectedNext: ReturnState | null;
}

/**
 * I8 STAGE STALL — stock that entered the pipeline and stopped moving.
 *
 * The failure this catches is not a refused transition, which is loud, but an
 * absent one, which is silent: a return that is accepted, quarantined off the
 * shelf, and then simply never collected. Nothing in I1-I6 fires, because
 * nothing happened — and "nothing happened" is exactly the state a party that
 * does not want the stock reconciled would choose.
 *
 * `since` is the server timestamp of the last transition. CLAUDE.md rule 5:
 * both timestamps are server-side.
 */
export function checkStageStall(input: {
  state: ReturnState;
  since: Date;
  serverNow: Date;
}): StallResult {
  const { state, since, serverNow } = input;
  const base: StallResult = {
    ok: true,
    stalled: false,
    state,
    elapsedDays: Math.floor((serverNow.getTime() - since.getTime()) / DAY_MS),
    slaDays: 0,
    overdueDays: 0,
    deadline: null,
    owedBy: null,
    expectedNext: null,
  };

  if (state === "CERTIFIED_DESTROYED") return base;

  const sla = STAGE_SLA[state as Exclude<ReturnState, "CERTIFIED_DESTROYED">];
  const deadline = new Date(since.getTime() + sla.days * DAY_MS);
  const overdueDays = Math.floor((serverNow.getTime() - deadline.getTime()) / DAY_MS);

  const enriched: StallResult = {
    ...base,
    slaDays: sla.days,
    deadline,
    owedBy: sla.owedBy,
    expectedNext: sla.next,
    overdueDays: Math.max(0, overdueDays),
  };

  if (serverNow.getTime() <= deadline.getTime()) return enriched;

  return {
    ...enriched,
    ok: false,
    stalled: true,
    code: AlertCode.STALLED_IN_PIPELINE,
    severity: overdueDays >= sla.days ? Severity.HIGH : Severity.MEDIUM,
    detail: {
      state,
      since: since.toISOString(),
      deadline: deadline.toISOString(),
      elapsedDays: enriched.elapsedDays,
      slaDays: sla.days,
      overdueDays: Math.max(0, overdueDays),
      owedBy: sla.owedBy,
      expectedNext: sla.next,
    },
  };
}
