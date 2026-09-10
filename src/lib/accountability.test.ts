// I7 and I8 — the two invariants added for quantity accountability and stalls.
// Same discipline as invariants.test.ts: pure inputs, no database.

import { describe, expect, it } from "vitest";
import {
  checkLocationBalance,
  checkStageStall,
  expectedExpiredReturn,
  locationBalance,
  LEDGER_DIRECTION,
  STAGE_SLA,
  DAY_MS,
} from "./invariants";
import { AlertCode, LedgerEvent, ReturnState, Severity } from "./types";

const NOW = new Date("2026-09-10T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY_MS);

describe("I7 location conservation", () => {
  it("every LedgerEvent variant has a direction", () => {
    for (const event of Object.values(LedgerEvent)) {
      expect(LEDGER_DIRECTION[event]).toBeDefined();
    }
  });

  it("a pharmacy that sold part of what it received is in balance", () => {
    const r = checkLocationBalance({ sums: { SUPPLIED: 100, BILLED: 40 } });
    expect(r.ok).toBe(true);
    expect(r.balance.balance).toBe(60);
  });

  it("shipping more than ever arrived is a breach, not a crash", () => {
    const r = checkLocationBalance({ sums: { SUPPLIED: 100, BILLED: 80, RETURN_INITIATED: 40 } });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(AlertCode.LOCATION_QUANTITY_BREACH);
    expect(r.severity).toBe(Severity.HIGH);
    expect(r.detail?.shortfall).toBe(20);
  });

  it("exactly zero is in balance — the check is >= 0, not > 0", () => {
    expect(checkLocationBalance({ sums: { SUPPLIED: 50, BILLED: 50 } }).ok).toBe(true);
  });

  it("a leak does NOT push the declaring party negative", () => {
    // RET-A: supplied 100, sold 40, returned 60. Distributor received 30, so a
    // LEAKED 30 row sits against RET-A. Counting it as a second departure would
    // report -30 for books that are in fact square.
    const r = checkLocationBalance({
      sums: { SUPPLIED: 100, BILLED: 40, RETURN_INITIATED: 60, LEAKED: 30 },
    });
    expect(r.ok).toBe(true);
    expect(r.balance.balance).toBe(0);
  });

  it("a full upstream hop nets to zero at each custodian", () => {
    expect(locationBalance({ RECEIVED: 30, TRANSFERRED: 30 }).balance).toBe(0);
    expect(locationBalance({ RECEIVED: 20, DESTROYED: 20 }).balance).toBe(0);
    expect(locationBalance({ ISSUED: 10_000, TRANSFERRED: 10_000 }).balance).toBe(0);
  });

  it("reports the contributing events so a breach can be explained, not just flagged", () => {
    const r = checkLocationBalance({ sums: { SUPPLIED: 10, BILLED: 25 }, orgId: "o1", batchId: "b1" });
    expect(r.detail?.byEvent).toEqual({ SUPPLIED: 10, BILLED: 25 });
    expect(r.detail?.orgId).toBe("o1");
  });
});

describe("expected expired return", () => {
  it("outstanding stock plus what was already sent back is the disposal obligation", () => {
    // 10,000 issued to one pharmacy, 8,000 sold -> 2,000 must come back.
    const r = expectedExpiredReturn({ sums: { SUPPLIED: 10_000, BILLED: 8_000 } });
    expect(r.onHand).toBe(2_000);
    expect(r.expected).toBe(2_000);
    expect(r.collected).toBe(0);
    expect(r.unaccounted).toBe(2_000);
  });

  it("collection closes the gap only as far as it actually went", () => {
    const r = expectedExpiredReturn({
      sums: { SUPPLIED: 10_000, BILLED: 8_000, RETURN_INITIATED: 1_700 },
    });
    expect(r.expected).toBe(2_000);
    expect(r.collected).toBe(1_700);
    expect(r.unaccounted).toBe(300);
  });

  it("a fully returned batch leaves nothing unaccounted", () => {
    const r = expectedExpiredReturn({
      sums: { SUPPLIED: 100, BILLED: 60, RETURN_INITIATED: 40 },
    });
    expect(r.unaccounted).toBe(0);
  });
});

describe("I8 stage stall", () => {
  it("a return inside its stage SLA is not stalled", () => {
    const r = checkStageStall({ state: ReturnState.INITIATED, since: daysAgo(1), serverNow: NOW });
    expect(r.stalled).toBe(false);
    expect(r.ok).toBe(true);
    expect(r.expectedNext).toBe(ReturnState.PICKUP_ASSIGNED);
  });

  it("past the deadline it stalls and names who owes the next event", () => {
    const r = checkStageStall({ state: ReturnState.INITIATED, since: daysAgo(9), serverNow: NOW });
    expect(r.stalled).toBe(true);
    expect(r.code).toBe(AlertCode.STALLED_IN_PIPELINE);
    expect(r.owedBy).toBe("DISTRIBUTOR");
    expect(r.expectedNext).toBe(ReturnState.PICKUP_ASSIGNED);
    expect(r.overdueDays).toBe(6);
  });

  it("escalates to HIGH once overdue by a full SLA period", () => {
    const mild = checkStageStall({ state: ReturnState.MANUFACTURER_RECEIVED, since: daysAgo(9), serverNow: NOW });
    const bad = checkStageStall({ state: ReturnState.MANUFACTURER_RECEIVED, since: daysAgo(20), serverNow: NOW });
    expect(mild.severity).toBe(Severity.MEDIUM);
    expect(bad.severity).toBe(Severity.HIGH);
  });

  it("the terminal state can never stall", () => {
    const r = checkStageStall({
      state: ReturnState.CERTIFIED_DESTROYED,
      since: daysAgo(9999),
      serverNow: NOW,
    });
    expect(r.stalled).toBe(false);
    expect(r.deadline).toBeNull();
  });

  it("exactly on the deadline is not yet overdue", () => {
    const sla = STAGE_SLA.INITIATED.days;
    const r = checkStageStall({ state: ReturnState.INITIATED, since: daysAgo(sla), serverNow: NOW });
    expect(r.stalled).toBe(false);
  });

  it("every non-terminal state has an SLA", () => {
    for (const state of Object.values(ReturnState)) {
      if (state === ReturnState.CERTIFIED_DESTROYED) continue;
      expect(STAGE_SLA[state as keyof typeof STAGE_SLA]).toBeDefined();
    }
  });
});
