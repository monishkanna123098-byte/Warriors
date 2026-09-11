// Movement of stock between organisations — the leg the ledger was missing.
//
// Before this module existed, nothing outside prisma/seed.ts wrote a SUPPLIED
// ledger row or created an Inventory row. The consequences were not cosmetic:
// raiseDueReturns() skips any retailer whose suppliedSum is 0, and I3 refuses a
// return that would exceed it, so stock that entered through the application
// could never be returned through it. The retail leg worked only for seeded data.
//
// Every transfer writes BOTH sides in one transaction — TRANSFERRED against the
// sender, SUPPLIED against the receiver — so a change of custody can never make
// units appear or disappear. That pairing is what I7 reads.
//
// This module does not mutate ReturnRequest.state or Batch.registryStatus
// (CLAUDE.md rule 2), and it evaluates no rule of its own (rule 1).

import type { Tx } from "./db";
import { appendAudit } from "./audit";
import { badRequest, conflict } from "./errors";
import { checkExistence, checkLocationBalance, locationBalance } from "./invariants";
import { eventSums, eventSumsByBatch } from "./ledger";
import {
  AlertCode,
  InventoryStatus,
  LedgerEvent,
  OrgType,
  RegistryStatus,
  Severity,
} from "./types";

export interface TransferRequest {
  batchId: string;
  toOrgId: string;
  qty: number;
  note?: string | null;
}

export interface TransferResult {
  transferId: string;
  batchId: string;
  batchNo: string;
  fromOrgId: string;
  toOrgId: string;
  qty: number;
  authorized: boolean;
  senderBalanceAfter: number;
  alerts: { code: AlertCode; severity: Severity; detail?: Record<string, unknown> }[];
  message: string;
}

/**
 * Is there an authorised route from one organisation to another?
 *
 * Two sources, deliberately: the explicit AuthorizedRoute table, and the
 * retailer's `mappedDistributorId`, which already encoded the retailer's one
 * legitimate distributor before this table existed. Reading both means existing
 * data stays correct without a backfill.
 *
 * SEPARATE from CDSCO licensing. A CDSCO-licensed wholesaler is still not an
 * authorised route for a manufacturer whose stock it has no relationship with —
 * merging the two would let a valid licence launder an unexplained movement.
 */
export async function isAuthorizedRoute(tx: Tx, fromOrgId: string, toOrgId: string): Promise<boolean> {
  const explicit = await tx.authorizedRoute.findUnique({
    where: { fromOrgId_toOrgId: { fromOrgId, toOrgId } },
  });
  if (explicit) return true;

  const to = await tx.organization.findUnique({ where: { id: toOrgId } });
  return to?.mappedDistributorId === fromOrgId;
}

/**
 * Executes a transfer. Must be called inside a transaction: the sender's balance
 * read and both ledger writes have to be atomic, or two concurrent dispatches
 * each see stock only one of them can actually have.
 */
export async function executeTransfer(
  tx: Tx,
  actor: { userId: string; orgId: string },
  req: TransferRequest,
): Promise<TransferResult> {
  if (req.qty <= 0) throw badRequest("VALIDATION_ERROR", "Transfer quantity must be at least 1.");
  if (req.toOrgId === actor.orgId) {
    throw badRequest("VALIDATION_ERROR", "An organisation cannot transfer stock to itself.");
  }

  const batch = await tx.batch.findUnique({
    where: { id: req.batchId },
    include: { manufacturer: true, product: true },
  });
  const existence = checkExistence({ batch });
  if (!existence.ok || !batch) {
    throw badRequest(AlertCode.UNKNOWN_BATCH, "That batch is not in any manufacturer's register.");
  }

  const to = await tx.organization.findUnique({ where: { id: req.toOrgId } });
  if (!to) throw badRequest("NOT_FOUND", "The receiving organisation does not exist.");

  // A batch certified destroyed cannot move again. Anything bearing the number
  // after that point is counterfeit or diverted, which is precisely what the POS
  // rule-2 block exists to catch — recording the movement as legitimate here
  // would hand it the paperwork it needs.
  if (batch.registryStatus === RegistryStatus.DESTROYED) {
    throw conflict(
      AlertCode.RESURRECTED_BATCH,
      "This batch was certified destroyed. Stock bearing this number cannot be transferred.",
    );
  }

  const alerts: TransferResult["alerts"] = [];

  // --- the sender must actually hold the units (I7, applied before the fact) ---
  const senderSums = await eventSums(tx, { batchId: batch.id, orgId: actor.orgId });
  const projected = checkLocationBalance({
    sums: { ...senderSums, TRANSFERRED: (senderSums.TRANSFERRED ?? 0) + req.qty },
    orgId: actor.orgId,
    batchId: batch.id,
  });
  if (!projected.ok) {
    throw conflict(
      AlertCode.LOCATION_QUANTITY_BREACH,
      `This location holds ${projected.balance.inbound - (projected.balance.outbound - req.qty)} units of ${batch.batchNo}; ${req.qty} cannot be transferred.`,
      projected.detail,
    );
  }

  // --- route integrity ------------------------------------------------------
  // An unauthorised transfer is RECORDED, not refused. Refusing it would only
  // move the stock off the books; the ledger's job is to know where units went,
  // and the alert is what makes the routing someone's problem to explain.
  const authorized = await isAuthorizedRoute(tx, actor.orgId, req.toOrgId);
  if (!authorized) {
    alerts.push({
      code: AlertCode.UNAUTHORIZED_ROUTE,
      severity: Severity.MEDIUM,
      detail: {
        fromOrgId: actor.orgId,
        toOrgId: req.toOrgId,
        toOrgName: to.name,
        reason: "no AuthorizedRoute and the receiver is not mapped to this sender",
      },
    });
  }

  if (
    batch.registryStatus === RegistryStatus.HELD ||
    batch.registryStatus === RegistryStatus.RECALLED
  ) {
    // Not a block: stock coming back off a shelf under a recall is the correct
    // response to one. It is flagged so the regulator can see the direction.
    alerts.push({
      code:
        batch.registryStatus === RegistryStatus.RECALLED
          ? AlertCode.RECALLED_SALE
          : AlertCode.HELD_SALE,
      severity: Severity.HIGH,
      detail: { registryStatus: batch.registryStatus, movedTo: to.name },
    });
  }

  const transfer = await tx.transfer.create({
    data: {
      fromOrgId: actor.orgId,
      toOrgId: req.toOrgId,
      batchId: batch.id,
      qty: req.qty,
      authorized,
      note: req.note ?? null,
    },
  });

  // Both sides, same transaction. Neither row is meaningful without the other.
  await tx.batchLedger.createMany({
    data: [
      {
        batchId: batch.id,
        orgId: actor.orgId,
        eventType: LedgerEvent.TRANSFERRED,
        qtyDelta: req.qty,
        refType: "Transfer",
        refId: transfer.id,
      },
      {
        batchId: batch.id,
        orgId: req.toOrgId,
        eventType: LedgerEvent.SUPPLIED,
        qtyDelta: req.qty,
        refType: "Transfer",
        refId: transfer.id,
      },
    ],
  });

  // Physical stock follows the ledger. Inventory is a convenience view for the
  // shelf; the ledger remains authoritative, so a disagreement between them is
  // resolved in the ledger's favour, never the other way round.
  const senderInv = await tx.inventory.findUnique({
    where: { orgId_batchId: { orgId: actor.orgId, batchId: batch.id } },
  });
  if (senderInv) {
    await tx.inventory.update({
      where: { id: senderInv.id },
      data: { qty: Math.max(0, senderInv.qty - req.qty) },
    });
  }
  await tx.inventory.upsert({
    where: { orgId_batchId: { orgId: req.toOrgId, batchId: batch.id } },
    create: {
      orgId: req.toOrgId,
      batchId: batch.id,
      qty: req.qty,
      status: InventoryStatus.ACTIVE,
    },
    update: { qty: { increment: req.qty } },
  });

  for (const a of alerts) {
    await tx.alert.create({
      data: {
        code: a.code,
        severity: a.severity,
        batchId: batch.id,
        orgId: actor.orgId,
        payload: (a.detail ?? {}) as never,
      },
    });
  }

  await appendAudit(tx, {
    entityType: "Transfer",
    entityId: transfer.id,
    action: "STOCK_TRANSFERRED",
    actorUserId: actor.userId,
    actorOrgId: actor.orgId,
    payload: {
      batchId: batch.id,
      batchNo: batch.batchNo,
      fromOrgId: actor.orgId,
      toOrgId: req.toOrgId,
      qty: req.qty,
      authorized,
      alerts: alerts.map((a) => a.code),
    },
  });

  const after = await eventSums(tx, { batchId: batch.id, orgId: actor.orgId });

  return {
    transferId: transfer.id,
    batchId: batch.id,
    batchNo: batch.batchNo,
    fromOrgId: actor.orgId,
    toOrgId: req.toOrgId,
    qty: req.qty,
    authorized,
    senderBalanceAfter: checkLocationBalance({ sums: after }).balance.balance,
    alerts,
    message: authorized
      ? `${req.qty} units of ${batch.batchNo} transferred to ${to.name}.`
      : `${req.qty} units of ${batch.batchNo} transferred to ${to.name}. No authorised route covers this movement — it is recorded and flagged for the regulator.`,
  };
}

/**
 * Counterparties this organisation can dispatch to, each marked with whether an
 * authorised route covers it.
 *
 * It deliberately returns OFF-ROUTE organisations too, rather than only the
 * authorised ones. `executeTransfer` records an unauthorised movement and raises
 * UNAUTHORIZED_ROUTE instead of refusing it — because refusing would only push
 * the stock off the books — so a picker that hides those destinations
 * contradicts the service behind it. It also left a retailer with an empty
 * dropdown and no explanation, since the authorised network runs
 * manufacturer -> distributor -> retailer and nothing is routed FROM a retailer.
 *
 * Excluded: the organisation itself, the regulator (it holds no stock), and
 * waste facilities (intake is a DisposalRequest, not a Transfer).
 *
 * `authorized` here is read from isAuthorizedRoute, the same function
 * executeTransfer uses. This module still decides nothing of its own.
 */
export async function transferDestinations(tx: Tx, fromOrgId: string) {
  const orgs = await tx.organization.findMany({
    where: {
      id: { not: fromOrgId },
      type: { in: [OrgType.MANUFACTURER, OrgType.DISTRIBUTOR, OrgType.RETAILER] },
    },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });

  const out = [];
  for (const o of orgs) {
    out.push({
      id: o.id,
      name: o.name,
      type: o.type as OrgType,
      licenseNo: o.licenseNo,
      district: o.district,
      authorized: await isAuthorizedRoute(tx, fromOrgId, o.id),
    });
  }
  // Authorised routes first, then everything else, each alphabetical.
  return out.sort(
    (a, b) => Number(b.authorized) - Number(a.authorized) || a.name.localeCompare(b.name),
  );
}

/**
 * Batches this organisation can dispatch, each with how many units it actually
 * holds and whether sending them will be refused or flagged.
 *
 * Without this the picker listed every batch in the register and said nothing,
 * so a manufacturer could pick one that was certified destroyed, or one whose
 * stock had already all been transferred out, and learn about it only from a red
 * error after pressing the button. The information to prevent that was already
 * in the ledger; it just was not being read.
 *
 * `available` is the I7 location balance — the same figure executeTransfer
 * checks before it writes anything — so what the picker promises and what the
 * service enforces cannot drift.
 */
export async function transferSources(tx: Tx, orgId: string) {
  const sums = await eventSumsByBatch(tx, orgId);
  if (sums.size === 0) return [];

  const batches = await tx.batch.findMany({
    where: { id: { in: [...sums.keys()] } },
    include: { product: true, manufacturer: true },
  });

  return batches
    .map((b) => {
      const balance = locationBalance(sums.get(b.id) ?? {});
      const status = b.registryStatus as RegistryStatus;

      // A certified-destroyed batch cannot move again at all; everything else
      // is a matter of how much is left.
      const blockedReason =
        status === RegistryStatus.DESTROYED
          ? "Certified destroyed — stock bearing this number cannot be transferred"
          : balance.balance <= 0
            ? "No units held here"
            : null;

      return {
        batchId: b.id,
        batchNo: b.batchNo,
        product: b.product.name,
        manufacturer: b.manufacturer.name,
        registryStatus: status,
        available: Math.max(0, balance.balance),
        blockedReason,
        // Held and recalled stock still moves — pulling it back off a shelf is
        // the correct response to a recall — but it raises an alert.
        flagged:
          status === RegistryStatus.HELD || status === RegistryStatus.RECALLED
            ? status
            : null,
      };
    })
    .sort(
      (a, b) =>
        Number(!!a.blockedReason) - Number(!!b.blockedReason) ||
        b.available - a.available ||
        a.batchNo.localeCompare(b.batchNo),
    );
}
