// CDSCO reference data layer — pure functions over already-fetched rows.
//
// This layer is READ-ONLY with respect to the rest of RCCP. It never writes to
// Bill, ReturnRequest, Batch or BatchLedger, and it never changes how
// invariants.ts decides anything. It is external ground truth that other
// features consult, not a mutator.
//
// The two signals it produces are deliberately kept apart from RCCP's own
// OK/EXPIRED bill status. They answer different questions:
//
//   Bill status  — "does OUR ledger say this stock is acceptable?"
//   NSQ status   — "has the REGULATOR flagged this batch on quality?"
//
// A batch can be clean in our ledger and NSQ-flagged, or expired in our ledger
// and never NSQ-flagged. Merging them into one status would lose exactly the
// information a regulator needs.

export interface NsqAlertRow {
  medicineName: string;
  batchNo: string;
  dateFlagged: Date;
  reason: string;
  source: string;
}

export interface LicensedEntityRow {
  name: string;
  licenseNo: string;
  type: "RETAILER" | "WHOLESALER";
  state: string;
  status: string;
}

export interface NsqCheckResult {
  flagged: boolean;
  medicineName: string;
  batchNo: string;
  reason: string | null;
  dateFlagged: string | null;
  source: string | null;
  /** Plain-language line for the UI. */
  message: string;
}

/** Loose comparison for externally-keyed text: trimmed, case-insensitive. */
const norm = (s: string) => s.trim().toUpperCase();

/**
 * Is this batch on the CDSCO not-of-standard-quality list?
 *
 * Matched on (medicineName, batchNo), never batchNo alone — batch numbers
 * collide across manufacturers (CLAUDE.md rule 6), so a bare batch number would
 * attach one maker's recall to another maker's stock.
 */
export function checkNsqStatus(
  medicineName: string,
  batchNo: string,
  rows: NsqAlertRow[],
): NsqCheckResult {
  const hit = rows.find(
    (r) => norm(r.medicineName) === norm(medicineName) && norm(r.batchNo) === norm(batchNo),
  );

  if (!hit) {
    return {
      flagged: false,
      medicineName,
      batchNo,
      reason: null,
      dateFlagged: null,
      source: null,
      message: "Not on the CDSCO not-of-standard-quality list.",
    };
  }

  return {
    flagged: true,
    medicineName: hit.medicineName,
    batchNo: hit.batchNo,
    reason: hit.reason,
    dateFlagged: hit.dateFlagged.toISOString(),
    source: hit.source,
    message: `Flagged by ${hit.source} on ${hit.dateFlagged.toISOString().slice(0, 10)}: ${hit.reason}.`,
  };
}

export interface LicenseCheckResult {
  found: boolean;
  active: boolean;
  licenseNo: string;
  name: string | null;
  type: string | null;
  state: string | null;
  status: string | null;
  message: string;
}

/**
 * Is this licence number a currently ACTIVE CDSCO-licensed entity?
 *
 * This is a DIFFERENT question from RCCP's own authorised-relationship check.
 * "Not CDSCO-licensed" means the regulator does not list them as trading;
 * "not an authorised relationship in RCCP" means our own routing does not
 * connect them. Callers must label the two distinctly and never conflate them.
 */
export function checkLicenseStatus(
  licenseNo: string,
  rows: LicensedEntityRow[],
): LicenseCheckResult {
  const hit = rows.find((r) => norm(r.licenseNo) === norm(licenseNo));

  if (!hit) {
    return {
      found: false,
      active: false,
      licenseNo,
      name: null,
      type: null,
      state: null,
      status: null,
      message: "Not present in the CDSCO licensed-entity register.",
    };
  }

  const active = norm(hit.status) === "ACTIVE";
  return {
    found: true,
    active,
    licenseNo: hit.licenseNo,
    name: hit.name,
    type: hit.type,
    state: hit.state,
    status: hit.status,
    message: active
      ? `${hit.name} is an ACTIVE CDSCO-licensed ${hit.type.toLowerCase()} in ${hit.state}.`
      : `${hit.name} is listed by CDSCO as ${hit.status}, not ACTIVE. Trading with this entity should be reviewed.`,
  };
}
