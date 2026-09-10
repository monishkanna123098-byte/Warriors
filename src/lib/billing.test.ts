import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { buildBillPayload, billHeadline, BillStatus, ANOMALY_CODE_FOR } from "./billing";
import { AlertCode } from "./types";

const subject = { batchId: "b1", returnRequestId: "r1", quantity: 50 };
const posSubject = { batchId: "b1", returnRequestId: null, quantity: 3 };

describe("buildBillPayload — OK case", () => {
  it("is OK with no anomalies and no note", () => {
    const b = buildBillPayload(subject, { alerts: [], expired: false });
    expect(b.status).toBe(BillStatus.OK);
    expect(b.anomalyCodes).toEqual([]);
    expect(b.anomalyNote).toBeNull();
  });

  it("carries the subject through unchanged", () => {
    const b = buildBillPayload(subject, { alerts: [], expired: false });
    expect(b).toMatchObject({ batchId: "b1", returnRequestId: "r1", quantity: 50 });
  });

  it("allows a null returnRequestId for a POS decision", () => {
    const b = buildBillPayload(posSubject, { alerts: [], expired: false });
    expect(b.returnRequestId).toBeNull();
    expect(b.status).toBe(BillStatus.OK);
  });
});

describe("buildBillPayload — I1 clone", () => {
  it("marks a cloned batch EXPIRED with code I1", () => {
    const b = buildBillPayload(subject, { alerts: [AlertCode.QUANTITY_BREACH], expired: false });
    expect(b.status).toBe(BillStatus.EXPIRED);
    expect(b.anomalyCodes).toEqual(["I1"]);
    expect(b.anomalyNote).toContain("cloned");
  });
});

describe("buildBillPayload — I2 invented batch", () => {
  it("marks an unknown batch EXPIRED with code I2", () => {
    const b = buildBillPayload(subject, { alerts: [AlertCode.UNKNOWN_BATCH], expired: false });
    expect(b.status).toBe(BillStatus.EXPIRED);
    expect(b.anomalyCodes).toEqual(["I2"]);
    expect(b.anomalyNote).toContain("never made under this number");
  });
});

describe("buildBillPayload — reused DESTROYED batch", () => {
  it("marks it EXPIRED with code REUSED_DESTROYED", () => {
    const b = buildBillPayload(subject, { alerts: [AlertCode.RESURRECTED_BATCH], expired: false });
    expect(b.status).toBe(BillStatus.EXPIRED);
    expect(b.anomalyCodes).toEqual(["REUSED_DESTROYED"]);
    expect(b.anomalyNote).toContain("certified destroyed");
  });
});

describe("buildBillPayload — expiry", () => {
  it("marks an out-of-date batch EXPIRED even with no alerts raised", () => {
    const b = buildBillPayload(subject, { alerts: [], expired: true });
    expect(b.status).toBe(BillStatus.EXPIRED);
    expect(b.anomalyNote).toContain("past its expiry date");
  });

  it("records I5 when the expiry alert was raised", () => {
    const b = buildBillPayload(subject, { alerts: [AlertCode.EXPIRED_SALE], expired: true });
    expect(b.anomalyCodes).toEqual(["I5"]);
  });
});

describe("buildBillPayload — non-blocking findings", () => {
  it("leaves the batch OK for leakage, which is a finding about a handoff", () => {
    const b = buildBillPayload(subject, { alerts: [AlertCode.LEAKAGE], expired: false });
    expect(b.status).toBe(BillStatus.OK);
    expect(b.anomalyCodes).toEqual(["I6"]);
    expect(b.anomalyNote).toContain("unaccounted");
  });

  it("leaves the batch OK for a weight mismatch", () => {
    const b = buildBillPayload(subject, { alerts: [AlertCode.WEIGHT_MISMATCH], expired: false });
    expect(b.status).toBe(BillStatus.OK);
  });

  it("still condemns the batch when a blocking alert accompanies a soft one", () => {
    const b = buildBillPayload(subject, {
      alerts: [AlertCode.LEAKAGE, AlertCode.RESURRECTED_BATCH],
      expired: false,
    });
    expect(b.status).toBe(BillStatus.EXPIRED);
    // The note explains the blocking finding, not the incidental one.
    expect(b.anomalyNote).toContain("certified destroyed");
    expect(b.anomalyCodes).toEqual(["I6", "REUSED_DESTROYED"]);
  });
});

describe("buildBillPayload — hygiene", () => {
  it("deduplicates repeated alerts", () => {
    const b = buildBillPayload(subject, {
      alerts: [AlertCode.QUANTITY_BREACH, AlertCode.QUANTITY_BREACH],
      expired: false,
    });
    expect(b.anomalyCodes).toEqual(["I1"]);
  });

  it("maps every AlertCode to an anomaly code — no silent gaps", () => {
    for (const code of Object.values(AlertCode)) {
      expect(ANOMALY_CODE_FOR[code]).toBeTruthy();
    }
  });

  it("produces a note for every blocking alert", () => {
    for (const code of Object.values(AlertCode)) {
      const b = buildBillPayload(subject, { alerts: [code], expired: false });
      if (b.status === BillStatus.EXPIRED) expect(b.anomalyNote).toBeTruthy();
    }
  });

  it("is pure — the same input yields an identical payload", () => {
    const a = buildBillPayload(subject, { alerts: [AlertCode.UNKNOWN_BATCH], expired: true });
    const b = buildBillPayload(subject, { alerts: [AlertCode.UNKNOWN_BATCH], expired: true });
    expect(a).toEqual(b);
  });
});

describe("billHeadline", () => {
  it("reads plainly for an OK bill", () => {
    expect(billHeadline(BillStatus.OK, [])).toBe("No compliance findings");
  });
  it("names the codes for an EXPIRED bill", () => {
    expect(billHeadline(BillStatus.EXPIRED, ["I1"])).toContain("I1");
  });
});

// ---------------------------------------------------------------------------
// Structural guarantees. These assert over the source tree, because the
// guarantee being tested is "no such code path exists anywhere" — which cannot
// be demonstrated by calling a function.
// ---------------------------------------------------------------------------

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (/\.(ts|tsx|mjs)$/.test(entry) && !entry.endsWith(".test.ts")) acc.push(full);
  }
  return acc;
}

const SRC = join(process.cwd(), "src");
const SCRIPTS = join(process.cwd(), "scripts");
const allSource = [...sourceFiles(SRC), ...sourceFiles(SCRIPTS)];
const read = (f: string) => readFileSync(f, "utf8");

describe("a Bill is permanent", () => {
  it("no code path anywhere updates or deletes a bill", () => {
    const offenders = allSource.filter((f) =>
      /\b(bill|Bill)\s*\.\s*(update|updateMany|delete|deleteMany|upsert)\s*\(/.test(read(f)),
    );
    expect(offenders).toEqual([]);
  });

  it("the bills route exposes GET only — no PATCH, PUT or DELETE", () => {
    const route = read(join(SRC, "app/api/bills/route.ts"));
    expect(route).toMatch(/export async function GET/);
    expect(route).not.toMatch(/export async function (POST|PATCH|PUT|DELETE)/);
  });

  it("has no route file under api/bills other than the GET route", () => {
    const files = sourceFiles(join(SRC, "app/api/bills"));
    expect(files.map((f) => f.split("/").pop())).toEqual(["route.ts"]);
  });

  it("billing.ts holds no invariant logic of its own", () => {
    const src = read(join(SRC, "lib/billing.ts"));
    // It must never import or re-run the invariant functions (CLAUDE.md rule 1).
    expect(src).not.toMatch(/from "\.\/invariants"/);
    expect(src).not.toMatch(/check(MassBalance|Existence|ReturnConservation|TemporalValidity)/);
  });

  it("billing.ts touches no database", () => {
    const src = read(join(SRC, "lib/billing.ts"));
    expect(src).not.toMatch(/prisma|PrismaClient|from "\.\/db"/);
  });
});

describe("an EXPIRED bill has no override path", () => {
  const posPage = read(join(SRC, "app/(app)/pos/page.tsx"));

  // Matches override AFFORDANCES — a state variable, prop, handler or request
  // field that would let someone continue. Deliberately not a bare /override/i,
  // which would also match UI copy stating that no override exists.
  const OVERRIDE_AFFORDANCE =
    /\b(allowOverride|canOverride|isOverride|onOverride|overrideBlock|overrideExpired|forceContinue|force_continue|forceAccept|acceptAnyway|proceedAnyway|continueAnyway|bypassBlock|ignoreBlock|dismissBlock)\b|\boverride\s*[:=]/;

  it("the POS terminal offers no override, force-continue or acknowledge-and-proceed", () => {
    expect(OVERRIDE_AFFORDANCE.test(posPage)).toBe(false);
  });

  it("no API route or library accepts an override flag", () => {
    const offenders = allSource.filter((f) => OVERRIDE_AFFORDANCE.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it("states plainly to the operator that no override exists", () => {
    expect(posPage).toMatch(/no override/i);
  });

  it("offers no control that continues with the blocked item", () => {
    // The only action on a hard-blocked terminal clears state for a DIFFERENT
    // item; nothing re-submits or accepts the refused one.
    expect(posPage).toMatch(/Clear and scan a different item/);
    expect(posPage).not.toMatch(/Accept anyway|Continue anyway|Proceed anyway/i);
  });

  it("the POS terminal blocks on an EXPIRED bill status", () => {
    expect(posPage).toMatch(/EXPIRED/);
  });
});
