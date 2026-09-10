import { describe, it, expect } from "vitest";
import {
  checkMassBalance,
  checkExistence,
  checkReturnConservation,
  checkCertificateCeiling,
  checkTemporalValidity,
  computeLeakage,
  checkBackdatedInvoice,
  checkWeightPlausibility,
  daysLeft,
  expiryStateFor,
  returnDueBy,
  DAY_MS,
} from "./invariants";
import { AlertCode, Severity, ExpiryState } from "./types";

const NOW = new Date("2026-09-10T12:00:00.000Z");
const days = (n: number) => new Date(NOW.getTime() + n * DAY_MS);

describe("I1 checkMassBalance", () => {
  it("passes when billed + incoming is under issued", () => {
    expect(checkMassBalance({ billedSum: 100, issuedQty: 500, incomingQty: 50 }).ok).toBe(true);
  });

  it("passes at exactly issuedQty — the boundary is inclusive", () => {
    expect(checkMassBalance({ billedSum: 195, issuedQty: 200, incomingQty: 5 }).ok).toBe(true);
  });

  it("breaches one unit over issuedQty", () => {
    const r = checkMassBalance({ billedSum: 195, issuedQty: 200, incomingQty: 6 });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(AlertCode.QUANTITY_BREACH);
    expect(r.severity).toBe(Severity.CRITICAL);
  });

  it("breaches on the seeded A12 clone scenario (195 billed + 10 > 200 issued)", () => {
    const r = checkMassBalance({ billedSum: 195, issuedQty: 200, incomingQty: 10 });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(AlertCode.QUANTITY_BREACH);
    expect(r.detail).toMatchObject({ projected: 205, issuedQty: 200, excess: 5 });
  });

  it("breaches when a fully-billed batch is scanned again", () => {
    expect(checkMassBalance({ billedSum: 500, issuedQty: 500, incomingQty: 1 }).ok).toBe(false);
  });
});

describe("I2 checkExistence", () => {
  it("passes for a resolved batch", () => {
    expect(checkExistence({ batch: { id: "b1" } }).ok).toBe(true);
  });

  it("breaches CRITICAL on null — unknown is never treated as clean", () => {
    const r = checkExistence({ batch: null });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(AlertCode.UNKNOWN_BATCH);
    expect(r.severity).toBe(Severity.CRITICAL);
  });

  it("breaches on undefined as well as null", () => {
    expect(checkExistence({ batch: undefined }).code).toBe(AlertCode.UNKNOWN_BATCH);
  });
});

describe("I3 checkReturnConservation", () => {
  it("passes for a first full return of supplied stock", () => {
    const r = checkReturnConservation({ returnInitiatedSum: 0, suppliedSum: 100, requestedQty: 100 });
    expect(r.ok).toBe(true);
  });

  it("breaches DOUBLE_RETURN when the same stock is returned twice (A2b)", () => {
    const r = checkReturnConservation({ returnInitiatedSum: 100, suppliedSum: 100, requestedQty: 100 });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(AlertCode.DOUBLE_RETURN);
    expect(r.severity).toBe(Severity.HIGH);
  });

  it("breaches on any excess above supplied, even one unit", () => {
    const r = checkReturnConservation({ returnInitiatedSum: 60, suppliedSum: 100, requestedQty: 41 });
    expect(r.ok).toBe(false);
    expect(r.detail).toMatchObject({ excess: 1 });
  });

  it("allows a partial second return that stays within supply", () => {
    expect(
      checkReturnConservation({ returnInitiatedSum: 60, suppliedSum: 100, requestedQty: 40 }).ok,
    ).toBe(true);
  });
});

describe("I4 checkCertificateCeiling", () => {
  it("rejects a certificate for more than was confirmed (A6: 100 against 70)", () => {
    const r = checkCertificateCeiling({ confirmedQty: 70, alreadyAllocated: 0, requestedQty: 100 });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(AlertCode.CERTIFICATE_OVER_ALLOCATION);
    expect(r.severity).toBe(Severity.HIGH);
    expect(r.detail).toMatchObject({ eligible: 70, requestedQty: 100, excess: 30 });
  });

  it("allows a partial allocation (A7: 40 of 70)", () => {
    expect(
      checkCertificateCeiling({ confirmedQty: 70, alreadyAllocated: 0, requestedQty: 40 }).ok,
    ).toBe(true);
  });

  it("allows the exact remainder across two certificates (A8: 40 then 30)", () => {
    expect(
      checkCertificateCeiling({ confirmedQty: 70, alreadyAllocated: 40, requestedQty: 30 }).ok,
    ).toBe(true);
  });

  it("rejects a third certificate once the ceiling is consumed", () => {
    const r = checkCertificateCeiling({ confirmedQty: 70, alreadyAllocated: 70, requestedQty: 1 });
    expect(r.ok).toBe(false);
    expect(r.detail).toMatchObject({ eligible: 0 });
  });

  it("rejects an allocation that would overshoot a partially consumed ceiling", () => {
    const r = checkCertificateCeiling({ confirmedQty: 70, alreadyAllocated: 40, requestedQty: 31 });
    expect(r.ok).toBe(false);
    expect(r.detail).toMatchObject({ eligible: 30, excess: 1 });
  });
});

describe("I5 checkTemporalValidity", () => {
  it("passes for a batch in date", () => {
    expect(checkTemporalValidity({ expiryDate: days(30), serverNow: NOW }).ok).toBe(true);
  });

  it("passes at the exact expiry instant — the boundary is inclusive", () => {
    expect(checkTemporalValidity({ expiryDate: NOW, serverNow: NOW }).ok).toBe(true);
  });

  it("breaches EXPIRED_SALE once past expiry", () => {
    const r = checkTemporalValidity({ expiryDate: days(-1), serverNow: NOW });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(AlertCode.EXPIRED_SALE);
    expect(r.severity).toBe(Severity.HIGH);
  });

  // A1: the batch's registryStatus is CLEAN throughout — it never entered the
  // return pipeline. I5 takes no registry input at all, which is what makes it
  // able to catch this case.
  it("breaches on a batch that never entered the return pipeline (A1)", () => {
    const r = checkTemporalValidity({ expiryDate: new Date("2026-08-01T00:00:00Z"), serverNow: NOW });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(AlertCode.EXPIRED_SALE);
    expect(Object.keys(r.detail ?? {})).not.toContain("registryStatus");
  });
});

describe("I6 computeLeakage", () => {
  it("reports zero leakage when received equals declared", () => {
    const r = computeLeakage({ declaredQty: 100, receivedQty: 100 });
    expect(r.ok).toBe(true);
    expect(r.leakedQty).toBe(0);
    expect(r.rejected).toBe(false);
    expect(r.code).toBeUndefined();
  });

  it("reports the shortfall without resolving it (A3: 70 against 100)", () => {
    const r = computeLeakage({ declaredQty: 100, receivedQty: 70 });
    expect(r.ok).toBe(false);
    expect(r.rejected).toBe(false); // the chain CONTINUES at receivedQty
    expect(r.leakedQty).toBe(30);
    expect(r.code).toBe(AlertCode.LEAKAGE);
    expect(r.severity).toBe(Severity.HIGH);
  });

  it("rejects the handoff outright when received exceeds declared (A4: 110 against 100)", () => {
    const r = computeLeakage({ declaredQty: 100, receivedQty: 110 });
    expect(r.rejected).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.leakedQty).toBe(0);
  });

  it("treats a total loss as full leakage, not a rejection", () => {
    const r = computeLeakage({ declaredQty: 100, receivedQty: 0 });
    expect(r.rejected).toBe(false);
    expect(r.leakedQty).toBe(100);
  });
});

describe("BACKDATED_INVOICE", () => {
  it("passes when no invoice date is claimed", () => {
    expect(checkBackdatedInvoice({ claimedInvoiceDate: null, serverTs: NOW }).ok).toBe(true);
  });

  it("passes within the 24h window", () => {
    const d = new Date(NOW.getTime() - 23 * 60 * 60 * 1000);
    expect(checkBackdatedInvoice({ claimedInvoiceDate: d, serverTs: NOW }).ok).toBe(true);
  });

  it("raises MEDIUM beyond 24h", () => {
    const r = checkBackdatedInvoice({ claimedInvoiceDate: days(-3), serverTs: NOW });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(AlertCode.BACKDATED_INVOICE);
    expect(r.severity).toBe(Severity.MEDIUM);
  });

  it("does not fire on a future-dated claim — that is not backdating", () => {
    expect(checkBackdatedInvoice({ claimedInvoiceDate: days(5), serverTs: NOW }).ok).toBe(true);
  });
});

describe("WEIGHT_MISMATCH (advisory)", () => {
  it("passes when weight is not recorded", () => {
    expect(
      checkWeightPlausibility({ receivedQty: 70, unitWeightG: 0.75, observedWeightG: null }).ok,
    ).toBe(true);
  });

  it("passes within tolerance", () => {
    expect(
      checkWeightPlausibility({ receivedQty: 70, unitWeightG: 0.75, observedWeightG: 55 }).ok,
    ).toBe(true);
  });

  it("raises MEDIUM when the mass is nowhere near the declared count", () => {
    const r = checkWeightPlausibility({ receivedQty: 70, unitWeightG: 0.75, observedWeightG: 12 });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(AlertCode.WEIGHT_MISMATCH);
    expect(r.severity).toBe(Severity.MEDIUM);
  });
});

describe("expiry helpers", () => {
  it("classifies NORMAL beyond 60 days", () => {
    expect(expiryStateFor(days(61), NOW)).toBe(ExpiryState.NORMAL);
  });

  it("classifies EXPIRY_WARNING at the 60-day boundary", () => {
    expect(expiryStateFor(days(60), NOW)).toBe(ExpiryState.EXPIRY_WARNING);
  });

  it("classifies EXPIRY_WARNING at one day left", () => {
    expect(expiryStateFor(days(1), NOW)).toBe(ExpiryState.EXPIRY_WARNING);
  });

  it("classifies RETURN_DUE at and past expiry", () => {
    expect(expiryStateFor(NOW, NOW)).toBe(ExpiryState.RETURN_DUE);
    expect(expiryStateFor(days(-5), NOW)).toBe(ExpiryState.RETURN_DUE);
  });

  it("reports negative daysLeft once expired", () => {
    expect(daysLeft(days(-3), NOW)).toBe(-3);
  });

  it("sets dueBy at expiry + 30 days", () => {
    const e = new Date("2026-08-15T00:00:00.000Z");
    expect(returnDueBy(e).toISOString()).toBe("2026-09-14T00:00:00.000Z");
  });
});
