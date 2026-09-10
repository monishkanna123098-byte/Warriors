import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { ok, toResponse } from "@/lib/http";
import { notFound } from "@/lib/errors";
import { batchAccount } from "@/lib/accountability";
import { LEDGER_DIRECTION } from "@/lib/invariants";
import { LedgerEvent, Role } from "@/lib/types";

export const dynamic = "force-dynamic";

interface ReplayEvent {
  at: string;
  kind: "LEDGER" | "AUDIT" | "ALERT" | "RECEIPT" | "HOLD" | "REPORT";
  event: string;
  qty: number | null;
  org: string | null;
  detail: string;
  /** The rule or anomaly involved, where one is. */
  rule: string | null;
  /** Set on the first event where the running balance stops adding up. */
  firstInconsistency?: boolean;
}

/**
 * FORENSIC REPLAY — one batch's complete history, in the order it happened.
 *
 * Every row here is read from a record that already existed: BatchLedger,
 * AuditEvent, Alert, Bill, HoldRecallOrder, CitizenReport. Nothing is inferred
 * and nothing is reconstructed. That is the point — a reconstruction a regulator
 * cannot trace back to a stored row is a story, not evidence.
 */
export async function GET(_req: Request, ctx: { params: { batchId: string } }) {
  try {
    await requireRole(Role.REGULATOR, Role.MANUFACTURER);
    const batchId = ctx.params.batchId;

    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
      include: { manufacturer: true, product: true },
    });
    if (!batch) throw notFound(`Batch ${batchId} not found`);

    const [ledger, audits, alerts, bills, holds, reports, account] = await Promise.all([
      prisma.batchLedger.findMany({
        where: { batchId },
        include: { org: true },
        orderBy: { serverTs: "asc" },
      }),
      prisma.auditEvent.findMany({
        where: { entityType: "Batch", entityId: batchId },
        orderBy: { id: "asc" },
      }),
      prisma.alert.findMany({ where: { batchId }, orderBy: { createdAt: "asc" } }),
      prisma.bill.findMany({ where: { batchId }, orderBy: { generatedAt: "asc" } }),
      prisma.holdRecallOrder.findMany({ where: { batchId }, orderBy: { createdAt: "asc" } }),
      prisma.citizenReport.findMany({ where: { batchId }, orderBy: { createdAt: "asc" } }),
      batchAccount(prisma, batchId, new Date()),
    ]);

    const events: ReplayEvent[] = [];

    // Running total across the whole batch: inbound minus outbound, ignoring the
    // manufacturer's own ISSUED row, which is the ceiling rather than a movement.
    let circulating = 0;
    let flagged = false;

    for (const row of ledger) {
      const dir = LEDGER_DIRECTION[row.eventType as LedgerEvent];
      if (row.eventType === LedgerEvent.ISSUED) circulating = 0;
      else if (dir === "IN") circulating += row.qtyDelta;
      else if (dir === "OUT") circulating -= row.qtyDelta;

      const e: ReplayEvent = {
        at: row.serverTs.toISOString(),
        kind: "LEDGER",
        event: row.eventType,
        qty: row.qtyDelta,
        org: row.org.name,
        detail: `${row.eventType} ${row.qtyDelta} units — ${row.org.name}`,
        rule: null,
      };
      // The first point where more units have left the chain than entered it.
      if (!flagged && circulating < 0) {
        e.firstInconsistency = true;
        e.rule = "I7 LOCATION CONSERVATION";
        e.detail += ` — more units have left this chain than ever entered it (${circulating})`;
        flagged = true;
      }
      events.push(e);
    }

    for (const a of alerts) {
      events.push({
        at: a.createdAt.toISOString(),
        kind: "ALERT",
        event: a.code,
        qty: null,
        org: null,
        detail: `${a.severity} — ${a.code}`,
        rule: a.code,
      });
    }

    for (const b of bills) {
      events.push({
        at: b.generatedAt.toISOString(),
        kind: "RECEIPT",
        event: `COMPLIANCE_RECEIPT_${b.status}`,
        qty: b.quantity,
        org: null,
        detail: b.anomalyNote ?? `Compliance receipt: ${b.status}`,
        rule: b.anomalyCodes.join(", ") || null,
      });
    }

    for (const h of holds) {
      events.push({
        at: h.createdAt.toISOString(),
        kind: "HOLD",
        event: h.action,
        qty: null,
        org: null,
        detail: h.reason,
        rule: h.action,
      });
    }

    for (const r of reports) {
      events.push({
        at: r.createdAt.toISOString(),
        kind: "REPORT",
        event: "CITIZEN_REPORTED",
        qty: null,
        org: r.location ?? null,
        detail: `${r.reason}${r.description ? ` — ${r.description}` : ""}`,
        rule: null,
      });
    }

    for (const a of audits) {
      // Ledger rows already tell the quantity story; audit rows are included for
      // the transitions that moved no units and would otherwise be invisible.
      if (["BATCH_ISSUED", "HOLD_ISSUED", "RECALL_ISSUED", "RELEASED"].includes(a.action)) continue;
      events.push({
        at: a.serverTs.toISOString(),
        kind: "AUDIT",
        event: a.action,
        qty: null,
        org: null,
        detail: a.action,
        rule: null,
      });
    }

    events.sort((x, y) => x.at.localeCompare(y.at));

    return ok({
      batch: {
        id: batch.id,
        batchNo: batch.batchNo,
        product: batch.product.name,
        manufacturer: batch.manufacturer.name,
        manufacturerLicenseNo: batch.manufacturer.licenseNo,
        issuedQty: batch.issuedQty,
        expiryDate: batch.expiryDate.toISOString(),
        registryStatus: batch.registryStatus,
      },
      events,
      account,
      firstInconsistencyAt: events.find((e) => e.firstInconsistency)?.at ?? null,
      limits:
        "This is the digital record and its hash chain. It shows what was recorded and that the record was not altered afterwards. It cannot show what physically happened to stock nobody recorded.",
    });
  } catch (e) {
    return toResponse(e);
  }
}
