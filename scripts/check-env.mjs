#!/usr/bin/env node
// Preflight for the deploy build.
//
// Prisma reports a missing or empty directUrl as a P1012 wasm validation error
// pointing at a schema line, which says nothing about which Vercel setting is
// wrong. This runs first and names the actual variable and the actual fix.

const problems = [];
const warnings = [];

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
