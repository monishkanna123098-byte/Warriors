// scripts/check-env.mjs — the preflight that fails a deploy build with the name
// of the variable that is wrong.
//
// Tested the same way import-cdsco.mjs is, by running the real script and
// reading its output. The value of this script is entirely in what it says when
// something is misconfigured, so asserting on the message is the point rather
// than an implementation detail.

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";

const GOOD_POOLED =
  "postgresql://u:p@ep-lively-frog-1234-pooler.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require&pgbouncer=true&connection_limit=1";
const GOOD_DIRECT =
  "postgresql://u:p@ep-lively-frog-1234.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require";
const GOOD_SECRET = "K/SeJ8/vxTTJlnNB2F9R27+EMfk0s1FTIMGtB5T2j+M=";

/** Runs the preflight with an explicit environment; returns exit code + output. */
function run(env: Record<string, string>) {
  // spawnSync rather than execFileSync: warnings go to stderr and the summary to
  // stdout, and execFileSync returns only the latter — so a warning would be
  // invisible to a test that was supposedly checking for it.
  const r = spawnSync("node", ["scripts/check-env.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

const GOOD = {
  DATABASE_URL: GOOD_POOLED,
  DIRECT_URL: GOOD_DIRECT,
  JWT_SECRET: GOOD_SECRET,
};

describe("deploy preflight", () => {
  it("passes on a correctly configured environment", () => {
    const r = run(GOOD);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/checks passed/i);
  });

  it("reads .env so it can be run before deploying, not only during a deploy", () => {
    // No variables passed at all. It must still find the local .env — otherwise
    // the only way to discover whether this script works is a failing build.
    const r = run({});
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/checks passed/i);
  });

  it("lets the platform environment override .env, never the other way round", () => {
    // A stale local file must not mask what the deploy is really configured with.
    const r = run({ ...GOOD, DIRECT_URL: "postgresql://user:pass@ep-xxx.region.aws.neon.tech/rccp" });
    expect(r.code).toBe(1);
    expect(r.out).toContain("DIRECT_URL");
  });

  it("names the variable holding a placeholder, and says why it matters", () => {
    const r = run({ ...GOOD, DIRECT_URL: "postgresql://u:p@ep-xxx.region.aws.neon.tech/rccp" });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/DIRECT_URL/);
    expect(r.out).toMatch(/placeholder/i);
    // The whole reason this check exists: a placeholder surfaces later as a
    // network error against a host that never existed.
    expect(r.out).toMatch(/P1001/);
  });

  it("distinguishes a variable that is empty from one that is absent", () => {
    const r = run({ ...GOOD, JWT_SECRET: "" });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/JWT_SECRET is set but empty/);
  });

  it("rejects a JWT secret too short to be worth having", () => {
    const r = run({ ...GOOD, JWT_SECRET: "short" });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/JWT_SECRET/);
    expect(r.out).toMatch(/32/);
  });

  it("warns when the migration URL is pooled — PgBouncer cannot take the locks", () => {
    const r = run({ ...GOOD, DIRECT_URL: GOOD_POOLED });
    expect(r.out).toMatch(/pooler|pooled/i);
  });

  it("reports which Vercel environment the build ran as", () => {
    // A variable ticked only for Production resolves to an empty string in a
    // Preview build, so the environment matters as much as the value.
    const r = run({ ...GOOD, VERCEL_ENV: "preview" });
    expect(r.out).toMatch(/preview/i);
  });

  it("catches every placeholder shipped in .env.example", () => {
    const templates = [
      "postgresql://user:pass@ep-xxx.region.aws.neon.tech/rccp",
      "postgresql://u:p@host/db?x=<your-value>",
      "https://your-app.vercel.app",
    ];
    for (const t of templates) {
      expect(run({ ...GOOD, DATABASE_URL: t }).code).toBe(1);
    }
    expect(run({ ...GOOD, JWT_SECRET: "generate-with-openssl-rand-base64-32" }).code).toBe(1);
  });
});
