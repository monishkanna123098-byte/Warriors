// Shared plumbing for the mutating return routes: ownership check, idempotency,
// one transaction, one call into lifecycle.transition().

import { prisma } from "@/lib/db";
import { forbidden, notFound } from "@/lib/errors";
import { ok, toResponse, withIdempotency } from "@/lib/http";
import {
  recordRejectionBill,
  transition,
  type Actor,
  type TransitionPayload,
} from "@/lib/lifecycle";
import { AppError } from "@/lib/errors";
import { AlertCode } from "@/lib/types";
import type { ReturnState } from "@/lib/types";
import type { SessionClaims } from "@/lib/auth";

/**
 * Which ReturnRequest party must match the caller's org. `null` means the caller
 * was already authorised against a different entity — the facility is not a party
 * on ReturnRequest, so its legs are checked against DisposalRequest.facilityId by
 * the route before it gets here.
 */
type OwnerField = "retailerId" | "distributorId" | "manufacturerId" | null;

/**
 * Runs one transition end to end.
 *
 * The whole operation — invariant reads, writes, ledger row, audit row — is a
 * single transaction, so a thrown invariant leaves nothing behind (acceptance A6).
 */
export async function runTransition(args: {
  req: Request;
  session: SessionClaims;
  returnId: string;
  ownerField: OwnerField;
  targetState: ReturnState;
  endpoint: string;
  body: unknown;
  payload: TransitionPayload;
}) {
  const { req, session, returnId, ownerField, targetState, endpoint, body, payload } = args;

  const existing = await prisma.returnRequest.findUnique({ where: { id: returnId } });
  if (!existing) throw notFound(`Return ${returnId} not found`);
  if (ownerField !== null && existing[ownerField] !== session.orgId) {
    throw forbidden("This return belongs to another organisation");
  }

  const idem = await withIdempotency(req, session.userId, endpoint, body);
  if (idem.replay) return idem.replay;

  const actor: Actor = { userId: session.userId, orgId: session.orgId, role: session.role };

  let result;
  try {
    result = await prisma.$transaction((tx) =>
      transition(returnId, targetState, actor, payload, tx),
    );
  } catch (err) {
    // A refused transition rolled its transaction back, so the refusal has no
    // surviving record. Write the compliance receipt for it in a transaction of
    // its own, then re-throw so the caller still sees the refusal.
    if (err instanceof AppError && err.code in AlertCode) {
      await prisma
        .$transaction((tx) =>
          recordRejectionBill(tx, {
            returnId,
            batchId: existing.batchId,
            quantity: existing.declaredQty ?? 0,
            code: err.code as AlertCode,
            actor,
            detail: err.detail,
          }),
        )
        // The receipt must never mask the original refusal.
        .catch((e) => console.error("[bill] failed to record rejection receipt", e));
    }
    throw err;
  }

  await idem.record(200, result);
  return ok(result);
}

export { toResponse };
