// consumer.ts — the layer behind /verify/bill/[token], the one page a stranger
// opens on their phone with no account.
//
// Pure functions throughout, so this file needs no database. The properties that
// matter are that every status branch is reachable and says the right thing, and
// that the demo-date control (CLAUDE.md rule 16) is genuinely one-directional:
// it may make a verdict stricter and must never make one laxer.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ConsumerStatus,
  consumerVerdict,
  fmtDate,
  formatBillNo,
  resolveAsOf,
  CONSUMER_SAFE_FIELDS,
} from "./consumer";
import { RegistryStatus } from "./types";

const NOW = new Date("2026-09-10T12:00:00.000Z");
const FUTURE = new Date("2027-06-30T00:00:00.000Z");
const PAST = new Date("2026-01-31T00:00:00.000Z");

const batch = (registryStatus: RegistryStatus, expiryDate: Date) => ({
  registryStatus,
  expiryDate,
  destroyedAt: registryStatus === RegistryStatus.DESTROYED ? new Date("2026-08-01") : null,
});

describe("consumerVerdict — every status branch", () => {
  it("UNKNOWN when no batch resolved, and does not call it fake", () => {
    const v = consumerVerdict({ batch: null, serverNow: NOW });
    expect(v.status).toBe(ConsumerStatus.UNKNOWN);
    expect(v.safe).toBe(false);
    // CLAUDE.md rule 7 makes unknown CRITICAL for the chain; for a member of the
    // public it must be honest about what it does and does not know.
    expect(v.explanation).toMatch(/does not automatically mean it is fake/i);
    expect(v.action).toMatch(/do not take it/i);
  });

  it("DESTROYED", () => {
    const v = consumerVerdict({ batch: batch(RegistryStatus.DESTROYED, FUTURE), serverNow: NOW });
    expect(v.status).toBe(ConsumerStatus.DESTROYED);
    expect(v.headline).toBe("DESTROYED — DO NOT USE");
    expect(v.safe).toBe(false);
  });

  it("RECALLED", () => {
    const v = consumerVerdict({ batch: batch(RegistryStatus.RECALLED, FUTURE), serverNow: NOW });
    expect(v.status).toBe(ConsumerStatus.RECALLED);
    expect(v.headline).toBe("RECALLED — DO NOT USE");
    expect(v.safe).toBe(false);
  });

  it("HELD, and says no finding has been made yet", () => {
    const v = consumerVerdict({ batch: batch(RegistryStatus.HELD, FUTURE), serverNow: NOW });
    expect(v.status).toBe(ConsumerStatus.HELD);
    expect(v.safe).toBe(false);
    // A hold is an investigation. Telling someone their medicine is defective
    // before anyone has established that would be its own harm.
    expect(v.explanation).toMatch(/no finding has been made/i);
  });

  it("EXPIRED, naming the date", () => {
    const v = consumerVerdict({ batch: batch(RegistryStatus.CLEAN, PAST), serverNow: NOW });
    expect(v.status).toBe(ConsumerStatus.EXPIRED);
    expect(v.safe).toBe(false);
    expect(v.explanation).toContain("31/01/2026");
  });

  it("VALID", () => {
    const v = consumerVerdict({ batch: batch(RegistryStatus.CLEAN, FUTURE), serverNow: NOW });
    expect(v.status).toBe(ConsumerStatus.VALID);
    expect(v.safe).toBe(true);
    expect(v.headline).toBe("VALID");
  });

  it("covers every ConsumerStatus variant — no branch is unreachable", () => {
    const reached = new Set([
      consumerVerdict({ batch: null, serverNow: NOW }).status,
      consumerVerdict({ batch: batch(RegistryStatus.DESTROYED, FUTURE), serverNow: NOW }).status,
      consumerVerdict({ batch: batch(RegistryStatus.RECALLED, FUTURE), serverNow: NOW }).status,
      consumerVerdict({ batch: batch(RegistryStatus.HELD, FUTURE), serverNow: NOW }).status,
      consumerVerdict({ batch: batch(RegistryStatus.CLEAN, PAST), serverNow: NOW }).status,
      consumerVerdict({ batch: batch(RegistryStatus.CLEAN, FUTURE), serverNow: NOW }).status,
    ]);
    expect(reached).toEqual(new Set(Object.values(ConsumerStatus)));
  });

  it("every verdict carries an explanation and an action, never a bare status", () => {
    for (const s of [RegistryStatus.CLEAN, RegistryStatus.HELD, RegistryStatus.RECALLED, RegistryStatus.DESTROYED]) {
      for (const exp of [PAST, FUTURE]) {
        const v = consumerVerdict({ batch: batch(s, exp), serverNow: NOW });
        expect(v.headline.length).toBeGreaterThan(0);
        expect(v.explanation.length).toBeGreaterThan(10);
        expect(v.action.length).toBeGreaterThan(10);
      }
    }
  });
});

describe("consumerVerdict — rule order matches the POS terminal", () => {
  it("registry status wins over expiry, so a recalled batch reads RECALLED not EXPIRED", () => {
    // A consumer scanning a pack and a pharmacist scanning the same pack must
    // never be told different things about it (§5.6 order).
    const v = consumerVerdict({ batch: batch(RegistryStatus.RECALLED, PAST), serverNow: NOW });
    expect(v.status).toBe(ConsumerStatus.RECALLED);
  });

  it("destroyed outranks recalled and held", () => {
    expect(
      consumerVerdict({ batch: batch(RegistryStatus.DESTROYED, PAST), serverNow: NOW }).status,
    ).toBe(ConsumerStatus.DESTROYED);
  });

  it("is VALID exactly on the expiry date and EXPIRED a moment later", () => {
    const expiry = new Date("2026-09-10T12:00:00.000Z");
    expect(consumerVerdict({ batch: batch(RegistryStatus.CLEAN, expiry), serverNow: expiry }).status).toBe(
      ConsumerStatus.VALID,
    );
    expect(
      consumerVerdict({
        batch: batch(RegistryStatus.CLEAN, expiry),
        serverNow: new Date(expiry.getTime() + 1),
      }).status,
    ).toBe(ConsumerStatus.EXPIRED);
  });
});

describe("resolveAsOf — the demo control is forward-only (CLAUDE.md rule 16)", () => {
  it("uses the server clock when nothing is asked for", () => {
    for (const input of [null, undefined, ""]) {
      const r = resolveAsOf(input, NOW);
      expect(r.asOf).toEqual(NOW);
      expect(r.simulated).toBe(false);
      expect(r.rejected).toBe(false);
    }
  });

  it("accepts a future date and marks it simulated", () => {
    const r = resolveAsOf("2027-01-01T00:00:00.000Z", NOW);
    expect(r.simulated).toBe(true);
    expect(r.asOf.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("REJECTS a past date and falls back to the server clock", () => {
    const r = resolveAsOf("2020-01-01T00:00:00.000Z", NOW);
    expect(r.rejected).toBe(true);
    expect(r.simulated).toBe(false);
    expect(r.asOf).toEqual(NOW);
  });

  it("rejects the present instant too — equal is not forward", () => {
    const r = resolveAsOf(NOW.toISOString(), NOW);
    expect(r.rejected).toBe(true);
    expect(r.asOf).toEqual(NOW);
  });

  it("rejects unparseable input rather than yielding an Invalid Date", () => {
    for (const junk of ["yesterday", "not-a-date", "1e9999", "🙂"]) {
      const r = resolveAsOf(junk, NOW);
      expect(r.rejected).toBe(true);
      expect(Number.isNaN(r.asOf.getTime())).toBe(false);
      expect(r.asOf).toEqual(NOW);
    }
  });

  it("never returns a date earlier than the server clock, for ANY input", () => {
    const inputs = [
      "1970-01-01T00:00:00.000Z",
      "2026-09-10T11:59:59.999Z",
      "-000001-01-01T00:00:00.000Z",
      "2026-09-09",
      "0000-01-01",
      String(-8.64e15),
      "Invalid Date",
    ];
    for (const i of inputs) {
      expect(resolveAsOf(i, NOW).asOf.getTime()).toBeGreaterThanOrEqual(NOW.getTime());
    }
  });
});

describe("no crafted date can make unsafe medicine look safe", () => {
  /** What the public endpoint actually does: resolve the lens, then judge. */
  const verdictAsOf = (b: Parameters<typeof consumerVerdict>[0]["batch"], asOf: string | null) =>
    consumerVerdict({ batch: b, serverNow: resolveAsOf(asOf, NOW).asOf });

  it("EXPIRED cannot be walked back to VALID by back-dating the URL", () => {
    const expired = batch(RegistryStatus.CLEAN, PAST);
    // Every one of these would show VALID if the date were taken at face value.
    for (const crafted of [
      "2025-01-01T00:00:00.000Z",
      "2026-01-30T00:00:00.000Z",
      "1999-12-31T23:59:59.999Z",
      "0001-01-01T00:00:00.000Z",
    ]) {
      expect(verdictAsOf(expired, crafted).status).toBe(ConsumerStatus.EXPIRED);
    }
  });

  it("RECALLED, HELD and DESTROYED ignore the date entirely", () => {
    for (const s of [RegistryStatus.RECALLED, RegistryStatus.HELD, RegistryStatus.DESTROYED]) {
      for (const crafted of [null, "2020-01-01T00:00:00.000Z", "2099-01-01T00:00:00.000Z"]) {
        expect(verdictAsOf(batch(s, FUTURE), crafted).safe).toBe(false);
      }
    }
  });

  it("the control can only ever make a verdict stricter", () => {
    const inDate = batch(RegistryStatus.CLEAN, FUTURE);
    expect(verdictAsOf(inDate, null).status).toBe(ConsumerStatus.VALID);
    // Forward past the expiry: VALID becomes EXPIRED. That direction is allowed.
    expect(verdictAsOf(inDate, "2028-01-01T00:00:00.000Z").status).toBe(ConsumerStatus.EXPIRED);
    // There is no input in the other direction that recovers a safe verdict.
    const wasExpired = batch(RegistryStatus.CLEAN, PAST);
    const anyInput = ["2020-01-01", "2026-01-01T00:00:00Z", "", null, "garbage"];
    expect(anyInput.every((i) => verdictAsOf(wasExpired, i).safe === false)).toBe(true);
  });
});

describe("formatting helpers", () => {
  it("renders dd/mm/yyyy, the format on an Indian pack", () => {
    expect(fmtDate(new Date("2026-09-30T00:00:00Z"))).toBe("30/09/2026");
    expect(fmtDate(new Date("2026-01-05T00:00:00Z"))).toBe("05/01/2026");
  });

  it("builds a bill number that sorts by day", () => {
    expect(formatBillNo(new Date("2026-09-11T10:00:00Z"), 1)).toBe("RCCP-20260911-001");
    expect(formatBillNo(new Date("2026-09-11T10:00:00Z"), 42)).toBe("RCCP-20260911-042");
  });
});

describe("consumer.ts module boundaries", () => {
  const src = readFileSync(join(process.cwd(), "src/lib/consumer.ts"), "utf8");

  it("decides nothing itself — expiry comes from invariants.ts", () => {
    expect(src).toMatch(/from "\.\/invariants"/);
    expect(src).toMatch(/checkTemporalValidity/);
    // No second implementation of the expiry comparison living here.
    expect(src).not.toMatch(/expiryDate\s*\.\s*getTime\(\)\s*[<>]/);
  });

  it("touches no database and writes nothing", () => {
    expect(src).not.toMatch(/from "\.\/db"/);
    expect(src).not.toMatch(/prisma/i);
    expect(src).not.toMatch(/\.(create|update|delete|upsert)\s*\(/);
  });

  it("names only consumer-safe fields — no patient, regulator or internal data", () => {
    expect(CONSUMER_SAFE_FIELDS).toContain("batchNo");
    for (const forbidden of ["patient", "riskScore", "note", "investigation"]) {
      expect(CONSUMER_SAFE_FIELDS as readonly string[]).not.toContain(forbidden);
    }
  });
});
