// docs/SPEC.md §7 — one global append-only hash chain.
//
// hash = SHA256(JSON.stringify(payload) + actorUserId + serverTs.toISOString() + (prevHash ?? ""))
//
// What this proves: the digital record was not altered after the fact.
// What it does NOT prove: that physical destruction occurred. Keep that caveat
// visible in the UI — see src/app/(app)/… certificate screens.

import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { Tx } from "./db";

/**
 * Deterministic serialisation with sorted keys.
 *
 * Postgres jsonb does NOT preserve key order: `{"a":1,"b":2}` can come back as
 * `{"b":2,"a":1}`. Hashing raw JSON.stringify output therefore breaks the chain
 * the moment a payload is read back and rehashed, which is exactly what
 * verifyChain does. Sorting keys makes write-time and read-time agree.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export function computeHash(input: {
  payload: unknown;
  actorUserId: string | null;
  serverTs: Date;
  prevHash: string | null;
}): string {
  const { payload, actorUserId, serverTs, prevHash } = input;
  return createHash("sha256")
    .update(canonicalJson(payload) + actorUserId + serverTs.toISOString() + (prevHash ?? ""))
    .digest("hex");
}

export interface AppendAuditInput {
  entityType: string;
  entityId: string;
  action: string;
  actorUserId?: string | null;
  actorOrgId?: string | null;
  payload: Prisma.InputJsonValue;
}

/**
 * Appends one link to the chain. Must run inside the same transaction as the
 * write it describes (CLAUDE.md rule 3) — otherwise a rolled-back operation
 * leaves an audit row claiming it happened.
 *
 * The chain is global and strictly ordered by id, so concurrent appends inside
 * overlapping transactions could in principle read the same tip. At demo
 * concurrency that does not arise; under real load this needs a serialisable
 * isolation level or an advisory lock on the chain tip. Noted, not solved.
 */
export interface AppendedAudit {
  id: bigint;
  hash: string;
}

export async function appendAudit(tx: Tx, input: AppendAuditInput): Promise<AppendedAudit> {
  const prev = await tx.auditEvent.findFirst({
    orderBy: { id: "desc" },
    select: { hash: true },
  });

  const serverTs = new Date();
  const actorUserId = input.actorUserId ?? null;
  const prevHash = prev?.hash ?? null;

  const hash = computeHash({ payload: input.payload, actorUserId, serverTs, prevHash });

  const created = await tx.auditEvent.create({
    data: {
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      actorUserId,
      actorOrgId: input.actorOrgId ?? null,
      payload: input.payload,
      prevHash,
      hash,
      serverTs,
    },
    select: { id: true },
  });

  return { id: created.id, hash };
}

export interface ChainVerification {
  valid: boolean;
  /** Id of the first event whose stored hash does not match a recomputation. */
  brokenAtId?: string;
  count: number;
}

/** Walks the whole chain. Backs GET /api/audit/verify. */
export async function verifyChain(tx: Tx): Promise<ChainVerification> {
  const events = await tx.auditEvent.findMany({ orderBy: { id: "asc" } });

  let prevHash: string | null = null;
  for (const e of events) {
    if ((e.prevHash ?? null) !== prevHash) {
      return { valid: false, brokenAtId: e.id.toString(), count: events.length };
    }
    const expected = computeHash({
      payload: e.payload,
      actorUserId: e.actorUserId,
      serverTs: e.serverTs,
      prevHash,
    });
    if (expected !== e.hash) {
      return { valid: false, brokenAtId: e.id.toString(), count: events.length };
    }
    prevHash = e.hash;
  }

  return { valid: true, count: events.length };
}
