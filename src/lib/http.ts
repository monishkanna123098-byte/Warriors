// Route boundary helpers: Zod validation, the { error: { code, message, detail } }
// envelope, and Idempotency-Key replay (SPEC §5).

import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { ZodError, type ZodSchema } from "zod";
import { AppError } from "./errors";
import { jsonSafe, prisma } from "./db";
import type { ApiErrorCode } from "./types";

export function ok(data: unknown, status = 200): NextResponse {
  return NextResponse.json(jsonSafe(data), { status });
}

export function fail(
  status: number,
  code: ApiErrorCode,
  message: string,
  detail?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json({ error: { code, message, detail: detail ?? null } }, { status });
}

/** Single catch for every route handler. */
export function toResponse(err: unknown): NextResponse {
  if (err instanceof AppError) return fail(err.status, err.code, err.message, err.detail);
  if (err instanceof ZodError) {
    return fail(400, "VALIDATION_ERROR", "Request body failed validation", {
      issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  console.error("[unhandled]", err);
  return fail(500, "CONFLICT", "Unexpected server error");
}

export async function parseBody<T>(req: Request, schema: ZodSchema<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    raw = {};
  }
  return schema.parse(raw);
}

function hashRequest(endpoint: string, body: unknown): string {
  return createHash("sha256").update(endpoint + JSON.stringify(body ?? null)).digest("hex");
}

export interface IdempotencyOutcome {
  /** A stored response to replay verbatim, or null to proceed with the operation. */
  replay: NextResponse | null;
  /** Call after a successful operation to record the response for future replays. */
  record: (status: number, body: unknown) => Promise<void>;
}

/**
 * SPEC §5: every mutating route accepts an Idempotency-Key header, checks the
 * IdempotencyKey table, and replays the stored response on a repeat.
 *
 * A repeat of the same key with a DIFFERENT body is not a retry — it is a client
 * bug or a replay attack — so it is refused with 409 rather than answered with a
 * response that does not describe what was asked for.
 *
 * The key is absent for a non-idempotent caller; the operation then just runs.
 */
export async function withIdempotency(
  req: Request,
  userId: string,
  endpoint: string,
  body: unknown,
): Promise<IdempotencyOutcome> {
  const key = req.headers.get("Idempotency-Key");
  if (!key) {
    return { replay: null, record: async () => undefined };
  }

  const requestHash = hashRequest(endpoint, body);
  const existing = await prisma.idempotencyKey.findUnique({ where: { key } });

  if (existing) {
    if (existing.requestHash !== requestHash) {
      return {
        replay: fail(
          409,
          "IDEMPOTENCY_KEY_REUSE",
          "This Idempotency-Key was already used for a different request body",
          { key, endpoint: existing.endpoint },
        ),
        record: async () => undefined,
      };
    }
    return {
      replay: NextResponse.json(existing.responseBody as never, {
        status: existing.responseStatus,
        headers: { "Idempotent-Replay": "true" },
      }),
      record: async () => undefined,
    };
  }

  return {
    replay: null,
    record: async (status, resBody) => {
      await prisma.idempotencyKey
        .create({
          data: {
            key,
            userId,
            endpoint,
            requestHash,
            responseStatus: status,
            responseBody: jsonSafe(resBody) as never,
          },
        })
        // A concurrent duplicate lost the race; the winner's row is authoritative.
        .catch(() => undefined);
    },
  };
}

/**
 * In-memory fixed-window limiter for the public /api/verify endpoint.
 *
 * Per-process only: it resets on redeploy and does not coordinate across serverless
 * instances. It stops a casual scraper, not a distributed one. A real deployment
 * puts this at the edge.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now > b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= limit) return false;
  b.count += 1;
  return true;
}

export function clientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}
