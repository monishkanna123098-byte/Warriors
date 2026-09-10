import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkNsqStatus, checkLicenseStatus } from "./cdsco";

const NSQ = [
  {
    medicineName: "Amoxicillin 500mg",
    batchNo: "B-1001",
    dateFlagged: new Date("2026-07-14T00:00:00Z"),
    reason: "Dissolution below pharmacopoeial limit",
    source: "CDSCO",
  },
  {
    medicineName: "Paracetamol 650mg",
    batchNo: "P-7781",
    dateFlagged: new Date("2026-08-21T00:00:00Z"),
    reason: "Description — mottled tablets",
    source: "CDSCO",
  },
];

const ENTITIES = [
  { name: "Anna Nagar Medicals", licenseNo: "DL/TN/4401", type: "RETAILER" as const, state: "TN", status: "ACTIVE" },
  { name: "Velachery Chemist", licenseNo: "DL/TN/4403", type: "RETAILER" as const, state: "TN", status: "SUSPENDED" },
  { name: "Madurai Medico", licenseNo: "DL/TN/4407", type: "RETAILER" as const, state: "TN", status: "EXPIRED" },
];

describe("checkNsqStatus", () => {
  it("matches a flagged batch", () => {
    const r = checkNsqStatus("Amoxicillin 500mg", "B-1001", NSQ);
    expect(r.flagged).toBe(true);
    expect(r.reason).toContain("Dissolution");
    expect(r.message).toContain("2026-07-14");
  });

  it("does not match an unflagged batch", () => {
    const r = checkNsqStatus("Amoxicillin 500mg", "B-3003", NSQ);
    expect(r.flagged).toBe(false);
    expect(r.reason).toBeNull();
  });

  it("is case- and whitespace-insensitive on external text", () => {
    expect(checkNsqStatus("  amoxicillin 500MG ", " b-1001 ", NSQ).flagged).toBe(true);
  });

  // The premise the whole system rests on: batch numbers collide across
  // manufacturers, so a bare batch number must never be sufficient to match.
  it("does NOT flag the same batch number under a different medicine", () => {
    const r = checkNsqStatus("Metformin 500mg", "B-1001", NSQ);
    expect(r.flagged).toBe(false);
  });

  it("returns a not-flagged result against an empty register", () => {
    expect(checkNsqStatus("Anything", "X-1", []).flagged).toBe(false);
  });
});

describe("checkLicenseStatus", () => {
  it("reports an ACTIVE entity as found and active", () => {
    const r = checkLicenseStatus("DL/TN/4401", ENTITIES);
    expect(r.found).toBe(true);
    expect(r.active).toBe(true);
    expect(r.message).toContain("ACTIVE");
  });

  it("reports a SUSPENDED entity as found but not active", () => {
    const r = checkLicenseStatus("DL/TN/4403", ENTITIES);
    expect(r.found).toBe(true);
    expect(r.active).toBe(false);
    expect(r.message).toContain("SUSPENDED");
  });

  it("reports an EXPIRED licence as found but not active", () => {
    const r = checkLicenseStatus("DL/TN/4407", ENTITIES);
    expect(r.found).toBe(true);
    expect(r.active).toBe(false);
  });

  it("reports an unknown licence as not found and not active", () => {
    const r = checkLicenseStatus("DL/TN/9999", ENTITIES);
    expect(r.found).toBe(false);
    expect(r.active).toBe(false);
    expect(r.message).toContain("Not present");
  });

  it("never reports not-found as active", () => {
    expect(checkLicenseStatus("nope", []).active).toBe(false);
  });
});

describe("cdsco.ts is a read-only reference layer", () => {
  const src = readFileSync(join(process.cwd(), "src/lib/cdsco.ts"), "utf8");

  it("touches no database", () => {
    expect(src).not.toMatch(/prisma|PrismaClient|from "\.\/db"/);
  });

  it("never writes to Bill, ReturnRequest, Batch or BatchLedger", () => {
    expect(src).not.toMatch(/\b(bill|returnRequest|batch|batchLedger)\s*\.\s*(create|update|delete|upsert)/i);
  });

  it("does not import the invariant or billing engines", () => {
    expect(src).not.toMatch(/from "\.\/(invariants|billing|lifecycle)"/);
  });
});

describe("import-cdsco.mjs", () => {
  const run = (args: string[]) =>
    execFileSync("node", ["scripts/import-cdsco.mjs", ...args], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

  it("imports the NSQ seed CSV and is idempotent on a re-run", () => {
    const first = run(["scripts/seed-data/nsq-alerts.csv"]);
    expect(first).toMatch(/NsqAlert/);
    const total = Number(/holds (\d+) rows/.exec(first)![1]);
    expect(total).toBe(10);

    const second = run(["scripts/seed-data/nsq-alerts.csv"]);
    expect(second).toMatch(/0 created/);
    expect(Number(/holds (\d+) rows/.exec(second)![1])).toBe(total);
  });

  it("imports the licensed-entity seed CSV and is idempotent on a re-run", () => {
    const first = run(["scripts/seed-data/licensed-entities.csv"]);
    const total = Number(/holds (\d+) rows/.exec(first)![1]);
    expect(total).toBe(10);

    const second = run(["scripts/seed-data/licensed-entities.csv"]);
    expect(second).toMatch(/0 created/);
    expect(Number(/holds (\d+) rows/.exec(second)![1])).toBe(total);
  });

  it("detects the table from the CSV header without a --table flag", () => {
    expect(run(["scripts/seed-data/nsq-alerts.csv"])).toMatch(/NsqAlert/);
    expect(run(["scripts/seed-data/licensed-entities.csv"])).toMatch(/LicensedEntity/);
  });

  it("honours an explicit --table flag", () => {
    expect(run(["scripts/seed-data/nsq-alerts.csv", "--table=nsq"])).toMatch(/NsqAlert/);
  });
});
