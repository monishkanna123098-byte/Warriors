# Deploying to Vercel + Neon

Two environment variables do the real work here, and getting them wrong is the
usual reason a Prisma app dies under load on serverless. Read §1 before clicking.

## 1. Why there are two database URLs

Neon gives you two connection strings for the same database:

| | Host | Used by | Why |
|---|---|---|---|
| `DATABASE_URL` | contains `-pooler` | the app at runtime | Each serverless invocation opens its own connection. Without the pooler, a few concurrent requests exhaust Postgres and everything 500s. |
| `DIRECT_URL` | no `-pooler` | `prisma migrate` only | Migrations take advisory locks and run DDL. PgBouncer in transaction mode cannot proxy either, so migrations must bypass it. |

`DATABASE_URL` also needs two query parameters that Prisma requires behind
PgBouncer:

```
?sslmode=require&pgbouncer=true&connection_limit=1
```

`connection_limit=1` is not a typo. Each function instance should hold exactly
one connection and let the pooler do the multiplexing.

## 2. Create the database

1. Create a Neon project, region close to your users.
2. Copy **both** connection strings from the dashboard — the pooled one and the
   direct one.

## 3. Import the repository

1. Vercel → Add New → Project → import `monishkanna123098-byte/Warriors`.
2. Select branch `claude/new-session-7hs7vo` (or merge it to `main` first).
3. Framework preset auto-detects as Next.js. Leave the build command alone —
   `package.json` defines a `vercel-build` script that Vercel prefers over
   `build`, and it runs `prisma migrate deploy` before `next build`. Your schema
   migrates on every deploy with no manual step.

## 4. Environment variables

Set all four, for Production (and Preview if you use it):

```
DATABASE_URL          the POOLED Neon URL, with the query params from §1
DIRECT_URL            the DIRECT Neon URL
JWT_SECRET            openssl rand -base64 32
NEXT_PUBLIC_BASE_URL  https://<your-app>.vercel.app
```

`JWT_SECRET` under 32 characters makes the app refuse to sign a session rather
than sign it with a weak key, so a short value fails loudly at first login
rather than quietly.

### If the build fails on environment variables

`scripts/check-env.mjs` runs first and names the offending variable directly.
The most common failure is `DIRECT_URL` present but blank — Vercel keeps a
variable whose value you never filled in, and Prisma then reports it as a schema
validation error against `prisma/schema.prisma:16`, which points at the wrong
thing entirely.

Set every variable for **every environment you deploy** — scoping them to
Production only means Preview builds fail with the same error.

## 5. Deploy, then seed once

Deploy. The build migrates the schema but does **not** seed — seeding is
destructive (it truncates every table) and must never run automatically.

Seed once from your laptop, pointing at Neon:

```bash
DATABASE_URL="<pooled url>" DIRECT_URL="<direct url>" npx prisma db seed
```

Then sign in at `https://<your-app>.vercel.app/login` as
`reta@annanagar.example` / `demo1234`.

## 6. Verify the deployment

```bash
BASE_URL=https://<your-app>.vercel.app node scripts/acceptance.mjs
```

All 17 items should pass against the deployed instance exactly as they do
locally. Reseed before each run — the harness mutates state.

Spot-check the public endpoint by hand, since it needs no auth:

```
https://<your-app>.vercel.app/verify/MFG-TN-001/B-1001
https://<your-app>.vercel.app/verify/MFG-TN-002/B-1001
```

Same batch number, different manufacturer. Before you run the demo flow both
read green; afterwards the first is red DESTROYED and the second is still green.

## Known deployment caveats

1. **`vercel-build` migrates whatever database its `DIRECT_URL` points at.** If
   you enable Preview deployments and give them the production URL, a preview
   build migrates production. Either give Preview its own Neon branch or leave
   Preview env vars unset.
2. **The `/api/verify` rate limiter is per-process and in-memory.** It resets on
   redeploy and does not coordinate across serverless instances, so it slows a
   casual scraper and nothing more. Real protection belongs at the edge —
   Vercel WAF or a KV-backed limiter.
3. **The audit chain reads its tip and appends within one transaction, but
   without serialisable isolation or an advisory lock.** Two genuinely
   concurrent appends could read the same predecessor and fork the chain. Demo
   traffic will not do this; sustained concurrent writes might. The fix is a
   `SELECT ... FOR UPDATE` on the chain tip or a transaction-scoped advisory
   lock.
4. **Cold starts.** Every route is `force-dynamic` because every verdict depends
   on the server clock and the ledger, so nothing is cacheable and a cold
   invocation pays Prisma's connection setup. Expect a slow first request after
   idle. Do a warm-up request before demoing.
