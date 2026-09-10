// docs/SPEC.md §4 — the ONLY module that mutates ReturnRequest.state or
// Batch.registryStatus (CLAUDE.md rule 2). Route handlers call transition();
// they never write those fields themselves.
//
// Everything here assumes it is already inside a prisma.$transaction. A failed
// invariant throws, and the throw rolls the transaction back — that is what makes
// acceptance A6 ("409 AND no row was written") true rather than aspirational.

import type { Tx } from "./db";
import { appendAudit } from "./audit";
import { AppError, badRequest, conflict } from "./errors";
import {
  checkCertificateCeiling,
  checkReturnConservation,
  checkWeightPlausibility,
  computeLeakage,
  returnDueBy,
} from "./invariants";
import {
  allocatedForBatch,
  returnInitiatedSum,
  suppliedSum,
} from "./ledger";
import {
  AlertCode,
  InventoryStatus,
  LedgerEvent,
  LeakageStatus,
  RegistryStatus,
  ReturnState,
  Severity,
} from "./types";

export interface Actor {
  userId: string;
  orgId: string;
  role: string;
}

/**
 * The legal transition graph, exactly as SPEC §4 states it. Linear: no skips,
 * no reversals, no self-loops.
 */
export const LEGAL_TRANSITIONS: Readonly<Record<ReturnState, readonly ReturnState[]>> = {
  RETURN_DUE: [ReturnState.INITIATED],
  INITIATED: [ReturnState.PICKUP_ASSIGNED],
  PICKUP_ASSIGNED: [ReturnState.DISTRIBUTOR_RECEIVED],
  DISTRIBUTOR_RECEIVED: [ReturnState.MANUFACTURER_RECEIVED],
  MANUFACTURER_RECEIVED: [ReturnState.DISPOSAL_SCHEDULED],
  DISPOSAL_SCHEDULED: [ReturnState.FACILITY_RECEIVED],
  FACILITY_RECEIVED: [ReturnState.CERTIFIED_DESTROYED],
  CERTIFIED_DESTROYED: [],
} as const;

export type TransitionPayload =
  | { to: typeof ReturnState.INITIATED; declaredQty: number; condition: string; photoUrl?: string | null }
  | { to: typeof ReturnState.PICKUP_ASSIGNED; pickupAt: Date }
  | {
      to: typeof ReturnState.DISTRIBUTOR_RECEIVED;
      scannedBatchNo: string;
      receivedQty: number;
      weightG?: number | null;
      photoUrl?: string | null;
    }
  | { to: typeof ReturnState.MANUFACTURER_RECEIVED; receivedQty: number }
  | { to: typeof ReturnState.DISPOSAL_SCHEDULED; facilityId: string; qty: number; scheduledDate: Date }
  | { to: typeof ReturnState.FACILITY_RECEIVED; disposalRequestId: string }
  | { to: typeof ReturnState.CERTIFIED_DESTROYED; disposalRequestId: string; qty: number };

export interface TransitionResult {
  returnId: string;
  from: ReturnState;
  to: ReturnState;
  /** Present when the transition raised a compliance finding alongside succeeding. */
  alerts: { code: AlertCode; severity: Severity; detail?: Record<string, unknown> }[];
  confirmedQty: number | null;
  registryStatus: RegistryStatus;
  certificateId?: string;
  disposalRequestId?: string;
  leakageRecordId?: string;
}

/** min() over the confirmed quantities present so far; nulls are "not yet known". */
export function computeConfirmedQty(r: {
  declaredQty: number | null;
  distReceivedQty: number | null;
  mfgReceivedQty: number | null;
}): number | null {
  const known = [r.declaredQty, r.distReceivedQty, r.mfgReceivedQty].filter(
    (n): n is number => n !== null && n !== undefined,
  );
  if (known.length === 0) return null;
  return Math.min(...known);
}

async function raiseAlert(
  tx: Tx,
  input: {
    code: AlertCode;
    severity: Severity;
    batchId?: string | null;
    orgId?: string | null;
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  await tx.alert.create({
    data: {
      code: input.code,
      severity: input.severity,
      batchId: input.batchId ?? null,
      orgId: input.orgId ?? null,
      payload: (input.detail ?? {}) as never,
    },
  });
}

/**
 * The single entry point for every return state change.
 *
 * @param tx  an interactive transaction client — NOT the bare prisma client.
 */
export async function transition(
  returnId: string,
  targetState: ReturnState,
  actor: Actor,
  payload: TransitionPayload,
  tx: Tx,
): Promise<TransitionResult> {
  const ret = await tx.returnRequest.findUnique({
    where: { id: returnId },
    include: { batch: { include: { product: true } } },
  });
  if (!ret) throw new AppError(404, "NOT_FOUND", `Return ${returnId} not found`);

  const from = ret.state as ReturnState;

  if (payload.to !== targetState) {
    throw badRequest("VALIDATION_ERROR", "Transition payload does not match the target state", {
      targetState,
      payloadTo: payload.to,
    });
  }

  if (!LEGAL_TRANSITIONS[from].includes(targetState)) {
    throw conflict("ILLEGAL_TRANSITION", `Cannot move a return from ${from} to ${targetState}`, {
      from,
      to: targetState,
      allowed: LEGAL_TRANSITIONS[from],
    });
  }

  const alerts: TransitionResult["alerts"] = [];
  const batch = ret.batch;
  let registryStatus = batch.registryStatus as RegistryStatus;
  let confirmedQty = ret.confirmedQty;
  let certificateId: string | undefined;
  let disposalRequestId: string | undefined;
  let leakageRecordId: string | undefined;

  switch (payload.to) {
    // -----------------------------------------------------------------------
    case ReturnState.INITIATED: {
      // I3: a retailer cannot put more into the pipeline than it was supplied.
      const [initiated, supplied] = await Promise.all([
        returnInitiatedSum(tx, ret.retailerId, ret.batchId),
        suppliedSum(tx, ret.retailerId, ret.batchId),
      ]);
      const i3 = checkReturnConservation({
        returnInitiatedSum: initiated,
        suppliedSum: supplied,
        requestedQty: payload.declaredQty,
      });
      if (!i3.ok) {
        await raiseAlert(tx, {
          code: AlertCode.DOUBLE_RETURN,
          severity: Severity.HIGH,
          batchId: ret.batchId,
          orgId: ret.retailerId,
          detail: i3.detail,
        });
        // The alert survives because the route re-raises it outside this tx;
        // see returns/[id]/initiate. The state change itself is refused.
        throw conflict(AlertCode.DOUBLE_RETURN, "This stock has already been returned", i3.detail);
      }

      confirmedQty = computeConfirmedQty({
        declaredQty: payload.declaredQty,
        distReceivedQty: null,
        mfgReceivedQty: null,
      });

      await tx.returnRequest.update({
        where: { id: returnId },
        data: {
          state: ReturnState.INITIATED,
          declaredQty: payload.declaredQty,
          condition: payload.condition,
          photoUrl: payload.photoUrl ?? null,
          initiatedAt: new Date(),
          confirmedQty,
        },
      });

      // registryStatus change #1 of exactly two (SPEC §4).
      await tx.batch.update({
        where: { id: ret.batchId },
        data: { registryStatus: RegistryStatus.IN_RETURN_PIPELINE },
      });
      registryStatus = RegistryStatus.IN_RETURN_PIPELINE;

      await tx.inventory.updateMany({
        where: { orgId: ret.retailerId, batchId: ret.batchId },
        data: { status: InventoryStatus.QUARANTINED },
      });

      await tx.batchLedger.create({
        data: {
          batchId: ret.batchId,
          orgId: ret.retailerId,
          eventType: LedgerEvent.RETURN_INITIATED,
          qtyDelta: payload.declaredQty,
          refType: "ReturnRequest",
          refId: returnId,
        },
      });
      break;
    }

    // -----------------------------------------------------------------------
    case ReturnState.PICKUP_ASSIGNED: {
      // No quantity moves, so no ledger row — see the note at the foot of this file.
      await tx.returnRequest.update({
        where: { id: returnId },
        data: { state: ReturnState.PICKUP_ASSIGNED, pickupAt: payload.pickupAt },
      });
      break;
    }

    // -----------------------------------------------------------------------
    case ReturnState.DISTRIBUTOR_RECEIVED: {
      // The scanned batch must be the batch the return is for. A mismatch is a
      // 400 reject, never a silent correction.
      if (payload.scannedBatchNo.trim().toUpperCase() !== batch.batchNo.toUpperCase()) {
        throw badRequest("BATCH_MISMATCH", "Scanned batch number does not match this return", {
          expected: batch.batchNo,
          scanned: payload.scannedBatchNo,
        });
      }

      const declared = ret.declaredQty ?? 0;
      const leak = computeLeakage({ declaredQty: declared, receivedQty: payload.receivedQty });

      if (leak.rejected) {
        throw badRequest("OVER_RECEIPT", "Cannot receive more units than were declared", {
          declaredQty: declared,
          receivedQty: payload.receivedQty,
        });
      }

      confirmedQty = computeConfirmedQty({
        declaredQty: ret.declaredQty,
        distReceivedQty: payload.receivedQty,
        mfgReceivedQty: ret.mfgReceivedQty,
      });

      await tx.returnRequest.update({
        where: { id: returnId },
        data: {
          state: ReturnState.DISTRIBUTOR_RECEIVED,
          distReceivedQty: payload.receivedQty,
          distWeightG: payload.weightG ?? null,
          distPhotoUrl: payload.photoUrl ?? null,
          distReceivedAt: new Date(),
          confirmedQty,
        },
      });

      await tx.batchLedger.create({
        data: {
          batchId: ret.batchId,
          orgId: ret.distributorId,
          eventType: LedgerEvent.RECEIVED,
          qtyDelta: payload.receivedQty,
          refType: "ReturnRequest",
          refId: returnId,
        },
      });

      if (leak.leakedQty > 0) {
        // CLAUDE.md rule 8: OPEN, never auto-closed, and the chain CONTINUES.
        const rec = await tx.leakageRecord.create({
          data: {
            returnId,
            batchId: ret.batchId,
            fromOrgId: ret.retailerId,
            toOrgId: ret.distributorId,
            declaredQty: declared,
            receivedQty: payload.receivedQty,
            leakedQty: leak.leakedQty,
            status: LeakageStatus.OPEN,
          },
        });
        leakageRecordId = rec.id;

        await tx.batchLedger.create({
          data: {
            batchId: ret.batchId,
            orgId: ret.retailerId,
            eventType: LedgerEvent.LEAKED,
            qtyDelta: leak.leakedQty,
            refType: "LeakageRecord",
            refId: rec.id,
          },
        });

        await raiseAlert(tx, {
          code: AlertCode.LEAKAGE,
          severity: Severity.HIGH,
          batchId: ret.batchId,
          orgId: ret.retailerId,
          detail: { ...leak.detail, returnId, leakageRecordId: rec.id },
        });
        alerts.push({ code: AlertCode.LEAKAGE, severity: Severity.HIGH, detail: leak.detail });
      }

      const weight = checkWeightPlausibility({
        receivedQty: payload.receivedQty,
        unitWeightG: batch.product.unitWeightG,
        observedWeightG: payload.weightG,
      });
      if (!weight.ok && weight.code) {
        await raiseAlert(tx, {
          code: weight.code,
          severity: weight.severity ?? Severity.MEDIUM,
          batchId: ret.batchId,
          orgId: ret.distributorId,
          detail: { ...weight.detail, returnId },
        });
        alerts.push({
          code: weight.code,
          severity: weight.severity ?? Severity.MEDIUM,
          detail: weight.detail,
        });
      }
      break;
    }

    // -----------------------------------------------------------------------
    case ReturnState.MANUFACTURER_RECEIVED: {
      const upstream = ret.distReceivedQty ?? ret.declaredQty ?? 0;
      const leak = computeLeakage({ declaredQty: upstream, receivedQty: payload.receivedQty });
      if (leak.rejected) {
        throw badRequest("OVER_RECEIPT", "Cannot receive more units than the distributor sent", {
          sentQty: upstream,
          receivedQty: payload.receivedQty,
        });
      }

      confirmedQty = computeConfirmedQty({
        declaredQty: ret.declaredQty,
        distReceivedQty: ret.distReceivedQty,
        mfgReceivedQty: payload.receivedQty,
      });

      await tx.returnRequest.update({
        where: { id: returnId },
        data: {
          state: ReturnState.MANUFACTURER_RECEIVED,
          mfgReceivedQty: payload.receivedQty,
          mfgReceivedAt: new Date(),
          confirmedQty,
        },
      });

      await tx.batchLedger.create({
        data: {
          batchId: ret.batchId,
          orgId: ret.manufacturerId,
          eventType: LedgerEvent.RECEIVED,
          qtyDelta: payload.receivedQty,
          refType: "ReturnRequest",
          refId: returnId,
        },
      });

      if (leak.leakedQty > 0) {
        const rec = await tx.leakageRecord.create({
          data: {
            returnId,
            batchId: ret.batchId,
            fromOrgId: ret.distributorId,
            toOrgId: ret.manufacturerId,
            declaredQty: upstream,
            receivedQty: payload.receivedQty,
            leakedQty: leak.leakedQty,
            status: LeakageStatus.OPEN,
          },
        });
        leakageRecordId = rec.id;

        await tx.batchLedger.create({
          data: {
            batchId: ret.batchId,
            orgId: ret.distributorId,
            eventType: LedgerEvent.LEAKED,
            qtyDelta: leak.leakedQty,
            refType: "LeakageRecord",
            refId: rec.id,
          },
        });

        await raiseAlert(tx, {
          code: AlertCode.LEAKAGE,
          severity: Severity.HIGH,
          batchId: ret.batchId,
          orgId: ret.distributorId,
          detail: { ...leak.detail, returnId, leakageRecordId: rec.id },
        });
        alerts.push({ code: AlertCode.LEAKAGE, severity: Severity.HIGH, detail: leak.detail });
      }
      break;
    }

    // -----------------------------------------------------------------------
    case ReturnState.DISPOSAL_SCHEDULED: {
      const ceiling = ret.confirmedQty ?? 0;
      if (payload.qty > ceiling) {
        throw badRequest("VALIDATION_ERROR", "Cannot schedule disposal above the confirmed quantity", {
          confirmedQty: ceiling,
          requestedQty: payload.qty,
        });
      }

      const facility = await tx.organization.findUnique({ where: { id: payload.facilityId } });
      if (!facility || facility.type !== "FACILITY") {
        throw badRequest("VALIDATION_ERROR", "Target organisation is not a disposal facility", {
          facilityId: payload.facilityId,
        });
      }

      const dr = await tx.disposalRequest.create({
        data: {
          returnId,
          batchId: ret.batchId,
          manufacturerId: ret.manufacturerId,
          facilityId: payload.facilityId,
          qty: payload.qty,
          scheduledDate: payload.scheduledDate,
        },
      });
      disposalRequestId = dr.id;

      await tx.returnRequest.update({
        where: { id: returnId },
        data: { state: ReturnState.DISPOSAL_SCHEDULED },
      });
      break;
    }

    // -----------------------------------------------------------------------
    case ReturnState.FACILITY_RECEIVED: {
      const dr = await tx.disposalRequest.findUnique({ where: { id: payload.disposalRequestId } });
      if (!dr || dr.returnId !== returnId) {
        throw badRequest("VALIDATION_ERROR", "Disposal request does not belong to this return", {
          disposalRequestId: payload.disposalRequestId,
        });
      }

      await tx.disposalRequest.update({
        where: { id: dr.id },
        data: { facilityReceivedAt: new Date() },
      });

      await tx.returnRequest.update({
        where: { id: returnId },
        data: { state: ReturnState.FACILITY_RECEIVED },
      });

      await tx.batchLedger.create({
        data: {
          batchId: ret.batchId,
          orgId: dr.facilityId,
          eventType: LedgerEvent.RECEIVED,
          qtyDelta: dr.qty,
          refType: "DisposalRequest",
          refId: dr.id,
        },
      });
      break;
    }

    // -----------------------------------------------------------------------
    case ReturnState.CERTIFIED_DESTROYED: {
      const dr = await tx.disposalRequest.findUnique({ where: { id: payload.disposalRequestId } });
      if (!dr || dr.returnId !== returnId) {
        throw badRequest("VALIDATION_ERROR", "Disposal request does not belong to this return", {
          disposalRequestId: payload.disposalRequestId,
        });
      }
      if (!dr.facilityReceivedAt) {
        throw conflict("ILLEGAL_TRANSITION", "Facility has not recorded receipt of this disposal", {
          disposalRequestId: dr.id,
        });
      }

      // I4. A breach throws, and the throw rolls back the whole transaction —
      // acceptance A6 requires that no certificate row survives a 409.
      const ceiling = ret.confirmedQty ?? 0;
      const alreadyAllocated = await allocatedForBatch(tx, ret.batchId);
      const i4 = checkCertificateCeiling({
        confirmedQty: ceiling,
        alreadyAllocated,
        requestedQty: payload.qty,
      });
      if (!i4.ok) {
        throw conflict(
          AlertCode.CERTIFICATE_OVER_ALLOCATION,
          "Requested quantity exceeds the eligible destruction ceiling",
          i4.detail,
        );
      }

      const cert = await tx.destructionCertificate.create({
        data: {
          certNo: `CERT-${dr.batchId.slice(-6).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`,
          disposalRequestId: dr.id,
          batchId: ret.batchId,
          facilityId: dr.facilityId,
          qty: payload.qty,
        },
      });
      certificateId = cert.id;

      await tx.batchLedger.create({
        data: {
          batchId: ret.batchId,
          orgId: dr.facilityId,
          eventType: LedgerEvent.DESTROYED,
          qtyDelta: payload.qty,
          refType: "DestructionCertificate",
          refId: cert.id,
        },
      });

      const nowAllocated = alreadyAllocated + payload.qty;

      // registryStatus change #2 of exactly two. A PARTIAL certificate must not
      // flip the batch to DESTROYED, and must not advance the return either —
      // see the note at the foot of this file.
      if (nowAllocated === ceiling && ceiling > 0) {
        await tx.returnRequest.update({
          where: { id: returnId },
          data: { state: ReturnState.CERTIFIED_DESTROYED },
        });
        await tx.batch.update({
          where: { id: ret.batchId },
          data: { registryStatus: RegistryStatus.DESTROYED, destroyedAt: new Date() },
        });
        registryStatus = RegistryStatus.DESTROYED;
      }
      break;
    }
  }

  const finalState =
    payload.to === ReturnState.CERTIFIED_DESTROYED && registryStatus !== RegistryStatus.DESTROYED
      ? from // partial certificate: the return stays where it was
      : targetState;

  await appendAudit(tx, {
    entityType: "ReturnRequest",
    entityId: returnId,
    action: `TRANSITION:${from}->${finalState}`,
    actorUserId: actor.userId,
    actorOrgId: actor.orgId,
    payload: {
      returnId,
      batchId: ret.batchId,
      from,
      to: finalState,
      requestedTarget: targetState,
      confirmedQty,
      registryStatus,
      certificateId: certificateId ?? null,
      disposalRequestId: disposalRequestId ?? null,
      leakageRecordId: leakageRecordId ?? null,
      alerts: alerts.map((a) => a.code),
    } as never,
  });

  return {
    returnId,
    from,
    to: finalState,
    alerts,
    confirmedQty,
    registryStatus,
    certificateId,
    disposalRequestId,
    leakageRecordId,
  };
}

/**
 * Raises RETURN_DUE rows for expired inventory. The system raises RETURN_DUE;
 * it never fabricates a return. Evidence (photo, condition, quantity) is a human
 * act, so INITIATED always requires a retailer action (SPEC §4).
 */
export async function raiseDueReturns(tx: Tx, serverNow: Date): Promise<number> {
  const expired = await tx.inventory.findMany({
    where: { status: InventoryStatus.ACTIVE, qty: { gt: 0 }, batch: { expiryDate: { lte: serverNow } } },
    include: { batch: true, org: true },
  });

  let created = 0;
  for (const inv of expired) {
    if (!inv.org.mappedDistributorId) continue; // no route upstream; nothing to raise

    // Only raise a return for stock the retailer has left to return. This is the
    // same headroom I3 enforces, so the due list never offers an action that the
    // invariant would then refuse — and it permits a batch to be returned in
    // instalments, which a single-row-per-batch rule would not.
    const [initiated, supplied] = await Promise.all([
      returnInitiatedSum(tx, inv.orgId, inv.batchId),
      suppliedSum(tx, inv.orgId, inv.batchId),
    ]);
    if (initiated >= supplied) continue;

    const openRow = await tx.returnRequest.findFirst({
      where: {
        batchId: inv.batchId,
        retailerId: inv.orgId,
        state: { notIn: [ReturnState.CERTIFIED_DESTROYED, ReturnState.RETURN_DUE] },
      },
    });
    if (openRow) continue; // one return in flight at a time per (retailer, batch)

    const existingDue = await tx.returnRequest.findFirst({
      where: { batchId: inv.batchId, retailerId: inv.orgId, state: ReturnState.RETURN_DUE },
    });
    if (existingDue) continue;

    await tx.returnRequest.create({
      data: {
        batchId: inv.batchId,
        retailerId: inv.orgId,
        distributorId: inv.org.mappedDistributorId,
        manufacturerId: inv.batch.manufacturerId,
        state: ReturnState.RETURN_DUE,
        dueBy: returnDueBy(inv.batch.expiryDate),
      },
    });
    created += 1;
  }
  return created;
}

// ---------------------------------------------------------------------------
// Two places where SPEC §4 is under-specified, and how this module resolves it.
//
// 1. "Every transition appends a BatchLedger row." PICKUP_ASSIGNED and
//    DISPOSAL_SCHEDULED move no units, and LedgerEvent has no variant for them
//    (CLAUDE.md rule: never invent an enum variant). Writing a RECEIVED row with
//    qtyDelta 0 would corrupt the very sums the invariants read, so those two
//    transitions append an AuditEvent only. Every transition without exception
//    is audited; only quantity movements reach the ledger.
//
// 2. A partial certificate. SPEC §4 says CERTIFIED_DESTROYED plus
//    alreadyAllocated === confirmedQty flips the batch to DESTROYED, and A7
//    requires the batch to stay IN_RETURN_PIPELINE after a partial certificate.
//    Since CERTIFIED_DESTROYED -> CERTIFIED_DESTROYED is not a legal transition,
//    a partial certificate cannot advance the return either: it issues the
//    certificate and leaves the return at FACILITY_RECEIVED, ready for the next
//    one. The return advances only when the ceiling is fully consumed (A8).
// ---------------------------------------------------------------------------
