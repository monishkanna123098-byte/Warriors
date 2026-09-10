// Compliance receipts — docs/SPEC.md is silent on these; see CLAUDE.md.
//
// Pure functions, no DB access, same shape as invariants.ts.
//
// CLAUDE.md rule 1 boundary: this module READS an outcome the invariants already
// produced and puts it into words. It must never evaluate a business rule of its
// own, and it must never change a verdict. If you find yourself wanting to write
// "if expired && qty > x" here, that rule belongs in invariants.ts.

import { AlertCode } from "./types";

export const BillStatus = { OK: "OK", EXPIRED: "EXPIRED" } as const;
export type BillStatus = (typeof BillStatus)[keyof typeof BillStatus];

/**
 * The stable anomaly identifier written onto a bill for each alert code.
 *
 * The invariant numbers match docs/SPEC.md §3, so a receipt can be traced back to
 * the exact rule that produced it. Codes without an invariant number get a
 * descriptive slug instead.
 */
export const ANOMALY_CODE_FOR: Readonly<Record<AlertCode, string>> = {
  QUANTITY_BREACH: "I1",
  UNKNOWN_BATCH: "I2",
  DOUBLE_RETURN: "I3",
  CERTIFICATE_OVER_ALLOCATION: "I4",
  EXPIRED_SALE: "I5",
  LEAKAGE: "I6",
  RESURRECTED_BATCH: "REUSED_DESTROYED",
  IN_PIPELINE_SALE: "IN_PIPELINE",
  WEIGHT_MISMATCH: "WEIGHT_MISMATCH",
  BACKDATED_INVOICE: "BACKDATED_INVOICE",
  LOCATION_QUANTITY_BREACH: "I7",
  STALLED_IN_PIPELINE: "I8",
  UNAUTHORIZED_ROUTE: "UNAUTHORIZED_ROUTE",
  RECALLED_SALE: "RECALLED",
  HELD_SALE: "HELD",
  CITIZEN_REPORT: "CITIZEN_REPORT",
} as const;

/**
 * Plain-language explanation per anomaly. Written for a pharmacist at a counter
 * and for a member of the public on /verify, not for an engineer: each says what
 * happened, why, and what to do.
 */
const NOTE_FOR: Readonly<Record<AlertCode, string>> = {
  QUANTITY_BREACH:
    "More units of this batch number are in circulation than the manufacturer ever released. The batch number has been cloned. Do not accept.",
  UNKNOWN_BATCH:
    "This batch number is not in the manufacturer's issued register. It was never made under this number. Do not accept.",
  DOUBLE_RETURN:
    "This stock has already been returned once. The same units cannot be returned twice. Do not accept.",
  CERTIFICATE_OVER_ALLOCATION:
    "More units were claimed for destruction than were confirmed received. Do not accept.",
  EXPIRED_SALE:
    "This batch is past its expiry date. It must be routed for return and destruction, not sold. Do not accept.",
  LEAKAGE:
    "Fewer units arrived than were declared. The shortfall is recorded as unaccounted and stays open for the regulator.",
  RESURRECTED_BATCH:
    "This batch was certified destroyed. Stock bearing this number is counterfeit or diverted. Do not accept — report it.",
  IN_PIPELINE_SALE:
    "This batch is already in the return pipeline and withdrawn from sale. Do not accept.",
  WEIGHT_MISMATCH:
    "The weight received does not match the declared unit count. Recount before proceeding.",
  BACKDATED_INVOICE:
    "The invoice date supplied is more than 24 hours before the server clock. Recorded as evidence.",
  LOCATION_QUANTITY_BREACH:
    "This location's records show more units leaving than ever arrived. That is an accounting inconsistency to reconcile, not by itself proof of wrongdoing.",
  STALLED_IN_PIPELINE:
    "This stock has sat at one stage past its deadline with no next event. Chase the organisation holding it.",
  UNAUTHORIZED_ROUTE:
    "Stock moved between two organisations with no authorised route between them. The movement is recorded; the routing needs explaining.",
  RECALLED_SALE:
    "This batch has been recalled by the regulator. Remove it from the shelf and return it. Do not dispense.",
  HELD_SALE:
    "This batch is under a regulator hold pending investigation. Do not dispense until the hold is lifted.",
  CITIZEN_REPORT:
    "A member of the public reported this batch. It is evidence for the regulator to weigh, not a finding against the batch.",
};

/**
 * Anomalies that make stock unacceptable. LEAKAGE, WEIGHT_MISMATCH and
 * BACKDATED_INVOICE are recorded on the receipt but do not by themselves condemn
 * the batch — a shortfall is a finding about a handoff, not about the units that
 * did arrive.
 */
const BLOCKING: ReadonlySet<AlertCode> = new Set<AlertCode>([
  AlertCode.QUANTITY_BREACH,
  AlertCode.UNKNOWN_BATCH,
  AlertCode.DOUBLE_RETURN,
  AlertCode.CERTIFICATE_OVER_ALLOCATION,
  AlertCode.EXPIRED_SALE,
  AlertCode.RESURRECTED_BATCH,
  AlertCode.IN_PIPELINE_SALE,
  // A regulator hold or recall condemns the stock as surely as expiry does.
  // The remaining new codes deliberately stay out: I7 and I8 are accounting
  // inconsistencies, UNAUTHORIZED_ROUTE is a routing question, and a citizen
  // report is evidence — none of them is a finding against the units themselves.
  AlertCode.RECALLED_SALE,
  AlertCode.HELD_SALE,
]);

/** The decision already reached elsewhere. Nothing here is re-evaluated. */
export interface BillInvariantOutcome {
  /** Alert codes the invariants raised. Empty means nothing was found. */
  alerts: AlertCode[];
  /** Whether the batch is past expiry, as I5 already determined. */
  expired: boolean;
}

/** The minimum a bill needs about what was being decided. */
export interface BillSubject {
  batchId: string;
  /** Null for a POS decision, which has no return behind it. */
  returnRequestId: string | null;
  quantity: number;
}

export interface BillPayload {
  batchId: string;
  returnRequestId: string | null;
  quantity: number;
  status: BillStatus;
  anomalyCodes: string[];
  anomalyNote: string | null;
}

/**
 * Turns an outcome into a receipt.
 *
 * EXPIRED means "this stock is not acceptable", which covers both an out-of-date
 * batch and one condemned by a blocking anomaly. OK means the decision found
 * nothing that stops the stock being used.
 */
export function buildBillPayload(
  subject: BillSubject,
  outcome: BillInvariantOutcome,
): BillPayload {
  // Deduplicated, and ordered by the alerts as given so the primary finding
  // stays first on the receipt.
  const seen = new Set<AlertCode>();
  const alerts = outcome.alerts.filter((a) => !seen.has(a) && seen.add(a));

  const anomalyCodes = alerts.map((a) => ANOMALY_CODE_FOR[a]);
  const blocking = alerts.filter((a) => BLOCKING.has(a));
  const status: BillStatus =
    outcome.expired || blocking.length > 0 ? BillStatus.EXPIRED : BillStatus.OK;

  let anomalyNote: string | null = null;
  if (blocking.length > 0) {
    anomalyNote = NOTE_FOR[blocking[0]];
  } else if (outcome.expired) {
    anomalyNote = NOTE_FOR[AlertCode.EXPIRED_SALE];
  } else if (alerts.length > 0) {
    // Non-blocking findings still get recorded, but the batch stays OK.
    anomalyNote = NOTE_FOR[alerts[0]];
  }

  return {
    batchId: subject.batchId,
    returnRequestId: subject.returnRequestId,
    quantity: subject.quantity,
    status,
    anomalyCodes,
    anomalyNote,
  };
}

/** Short label for a receipt, used in dashboards and on /verify. */
export function billHeadline(status: BillStatus, anomalyCodes: string[]): string {
  if (status === BillStatus.OK) return "No compliance findings";
  return anomalyCodes.length > 0
    ? `Not acceptable — ${anomalyCodes.join(", ")}`
    : "Not acceptable";
}
