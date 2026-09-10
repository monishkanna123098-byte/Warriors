import { describe, it, expect } from "vitest";
import { LEGAL_TRANSITIONS, computeConfirmedQty } from "./lifecycle";
import { ReturnState } from "./types";

describe("LEGAL_TRANSITIONS", () => {
  it("is the linear chain SPEC §4 specifies", () => {
    const order: ReturnState[] = [
      ReturnState.RETURN_DUE,
      ReturnState.INITIATED,
      ReturnState.PICKUP_ASSIGNED,
      ReturnState.DISTRIBUTOR_RECEIVED,
      ReturnState.MANUFACTURER_RECEIVED,
      ReturnState.DISPOSAL_SCHEDULED,
      ReturnState.FACILITY_RECEIVED,
      ReturnState.CERTIFIED_DESTROYED,
    ];
    for (let i = 0; i < order.length - 1; i++) {
      expect(LEGAL_TRANSITIONS[order[i]]).toEqual([order[i + 1]]);
    }
    expect(LEGAL_TRANSITIONS[ReturnState.CERTIFIED_DESTROYED]).toEqual([]);
  });

  it("permits no skips, reversals, or self-loops", () => {
    for (const [from, tos] of Object.entries(LEGAL_TRANSITIONS)) {
      expect(tos).not.toContain(from);
      expect(tos.length).toBeLessThanOrEqual(1);
    }
  });

  it("covers every ReturnState variant", () => {
    expect(Object.keys(LEGAL_TRANSITIONS).sort()).toEqual(Object.values(ReturnState).sort());
  });
});

describe("computeConfirmedQty", () => {
  it("is null before anything is declared", () => {
    expect(
      computeConfirmedQty({ declaredQty: null, distReceivedQty: null, mfgReceivedQty: null }),
    ).toBeNull();
  });

  it("is the declared quantity at INITIATED", () => {
    expect(
      computeConfirmedQty({ declaredQty: 100, distReceivedQty: null, mfgReceivedQty: null }),
    ).toBe(100);
  });

  it("drops to the distributor receipt on a shortfall (A3)", () => {
    expect(
      computeConfirmedQty({ declaredQty: 100, distReceivedQty: 70, mfgReceivedQty: null }),
    ).toBe(70);
  });

  it("takes the min across the whole chain", () => {
    expect(computeConfirmedQty({ declaredQty: 100, distReceivedQty: 70, mfgReceivedQty: 65 })).toBe(65);
  });

  it("never rises again once a shortfall is recorded", () => {
    expect(computeConfirmedQty({ declaredQty: 100, distReceivedQty: 70, mfgReceivedQty: 70 })).toBe(70);
  });
});
