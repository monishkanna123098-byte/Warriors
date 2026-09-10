#!/usr/bin/env node
import { readFileSync } from "node:fs";
// Preflight for the deploy build.
//
// Prisma reports a missing or empty directUrl as a P1012 wasm validation error
// pointing at a schema line, which says nothing about which Vercel setting is
// wrong. This runs first and names the actual variable and the actual fix.

const problems = [];
const warnings = [];

// Load .env when one is present, so this script behaves identically whether it
// runs locally or on Vercel.
//
// Without this it reads process.env only — which means the one script whose
// entire job is to stop a broken deploy could never be exercised before
// deploying, and the first time anyone found out whether it worked was in a
// failing build. Vercel has no .env file, so this is a no-op there.
//
// Platform environment ALWAYS wins: a stale local file must never mask what the
// deploy is actually configured with. Parsed by hand rather than with dotenv,
// which is not a dependency of this project.
function loadDotEnv() {
  let text;
  try {
    text = readFileSync(new URL("../.env", import.meta.url), "utf8");
  } catch {
    return; // no .env — the normal case in CI and on Vercel
  }
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (key in process.env) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
loadDotEnv();

// Which Vercel environment this build is running as. A variable ticked only for
// Production resolves to an EMPTY STRING in a Preview build rather than raising
// anything, so the environment matters as much as the value and belongs in the
// output either way.
const vercelEnv = process.env.VERCEL_ENV ?? null;
const gitRef = process.env.VERCEL_GIT_COMMIT_REF ?? null;
if (vercelEnv) {
  console.log(
    `Checking environment variables for VERCEL_ENV=${vercelEnv}` +
      (gitRef ? ` (branch ${gitRef})` : ""),
  );
}

const get = (k) => (process.env[k] ?? "").trim();

function require_(key, hint) {
  const v = get(key);
  if (!v) problems.push({ key, why: process.env[key] === undefined ? "is not set" : "is set but empty", hint });
  return v;
}

const databaseUrl = require_(
  "DATABASE_URL",
  'The POOLED connection string. On Neon the host contains "-pooler".\n' +
    "     Append ?sslmode=require&pgbouncer=true&connection_limit=1",
);

const directUrl = require_(
  "DIRECT_URL",
  "The UNPOOLED connection string — the same host WITHOUT \"-pooler\".\n" +
    "     Migrations take advisory locks that PgBouncer cannot proxy, so they\n" +
    "     cannot use the pooled URL. Append ?sslmode=require",
);

const jwtSecret = require_("JWT_SECRET", "Generate one with: openssl rand -base64 32");
if (jwtSecret && jwtSecret.length < 32) {
  problems.push({
    key: "JWT_SECRET",
    why: `is only ${jwtSecret.length} characters`,
    hint: "Must be at least 32. Generate one with: openssl rand -base64 32",
  });
}

// Placeholder detection.
//
// A value copied from .env.example is present, non-empty and correctly shaped,
// so every structural check passes and the failure surfaces much later as
// "P1001: can't reach database server" against a host that never existed. That
// error blames the network for what is actually an unfilled field, so it is
// worth catching here by name.
const PLACEHOLDERS = [
  "ep-xxx",
  ".region.aws.neon.tech",
  "user:pass",
  "your-app",
  "your_app",
  "generate-with-openssl",
  "a-long-random-string",
  "changeme",
  "<",
  "example.com",
];

function placeholderIn(value) {
  const v = value.toLowerCase();
  return PLACEHOLDERS.find((m) => v.includes(m));
}

for (const [key, value] of [
  ["DATABASE_URL", databaseUrl],
  ["DIRECT_URL", directUrl],
  ["JWT_SECRET", jwtSecret],
]) {
  if (!value) continue;
  const marker = placeholderIn(value);
  if (marker) {
    problems.push({
      key,
      why: `still contains the placeholder "${marker}" from .env.example`,
      hint:
        "Replace it with the real value. A placeholder passes every shape check and\n" +
        "     then fails at connection time as P1001 against a host that does not exist,\n" +
        "     which reads like a network outage rather than an unfilled field.",
    });
  }
}

// Misconfigurations that build fine and then fail in production, so they are
// worth saying out loud even though they are not fatal here.
if (directUrl.includes("-pooler")) {
  warnings.push(
    'DIRECT_URL points at a "-pooler" host. Migrations run through PgBouncer\n' +
      "   fail with confusing advisory-lock errors. Use the unpooled host.",
  );
}
if (databaseUrl && !databaseUrl.includes("-pooler") && databaseUrl.includes("neon.tech")) {
  warnings.push(
    'DATABASE_URL does not point at a "-pooler" host. Each serverless invocation\n' +
      "   opens its own connection, so an unpooled runtime URL exhausts Postgres\n" +
      "   under concurrency.",
  );
}
if (databaseUrl.includes("-pooler") && !databaseUrl.includes("pgbouncer=true")) {
  warnings.push(
    "DATABASE_URL is pooled but missing pgbouncer=true. Prisma needs it to skip\n" +
      "   prepared statements, which PgBouncer in transaction mode cannot hold.",
  );
}
if (databaseUrl.includes("-pooler") && !databaseUrl.includes("connection_limit=")) {
  warnings.push(
    "DATABASE_URL is pooled but missing connection_limit=1. Without it each\n" +
      "   instance opens a Prisma-sized pool behind the pooler's pool.",
  );
}

for (const w of warnings) console.warn(`\n⚠  ${w}`);

if (problems.length > 0) {
  console.error("\n" + "─".repeat(68));
  console.error("Deploy cannot proceed — environment variables are incomplete.\n");
  for (const p of problems) {
    console.error(`  ✗ ${p.key} ${p.why}`);
    console.error(`     ${p.hint}\n`);
  }
  if (vercelEnv) {
    console.error(`This build ran as VERCEL_ENV=${vercelEnv}.`);
    console.error("");
    console.error("A variable that HAS a value but is not ticked for this environment");
    console.error(`resolves to an empty string here. Before re-entering values, open each`);
    console.error(`variable above and confirm "${vercelEnv}" is among its checked`);
    console.error("environments — the dashboard list shows the variable as set either way.");
  } else {
    console.error("Set these in Vercel → Settings → Environment Variables, for every");
    console.error("environment you deploy (Production, Preview, Development), then");
    console.error("redeploy.");
  }
  console.error("");
  console.error("Full guidance: docs/DEPLOY.md");
  console.error("─".repeat(68) + "\n");
  process.exit(1);
}

// Never claim a clean bill of health over the top of a warning — the success
// line has to be consistent with what was just printed above it.
console.log(
  warnings.length === 0
    ? "Environment checks passed: pooled runtime URL, unpooled migration URL, strong secret."
    : `Environment checks passed with ${warnings.length} warning(s) above. Continuing.`,
);
