import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { ok, parseBody, toResponse, withIdempotency } from "@/lib/http";
import { decideScan } from "@/lib/pos";
import { appendAudit } from "@/lib/audit";
import { buildBillPayload } from "@/lib/billing";
import { ScanContext, ScanVerdict } from "@/lib/types";

export const dynamic = "force-dynamic";

const Body = z.object({
  manufacturerRef: z.string().min(1),
  batchNo: z.string().min(1),
  qty: z.number().int().positive(),
  context: z.nativeEnum(ScanContext),
  // Evidence only. CLAUDE.md rule 5: never an input to the verdict.
  claimedInvoiceDate: z.string().datetime().optional().nullable(),
});

export async function POST(req: Request) {
  try {
    const session = await requireSession();
    const body = await parseBody(req, Body);

    const idem = await withIdempotency(req, session.userId, "POST /api/pos/scan", body);
    if (idem.replay) return idem.replay;

    const serverTs = new Date();
    const claimed = body.claimedInvoiceDate ? new Date(body.claimedInvoiceDate) : null;

    const decision = await prisma.$transaction(async (tx) => {
      const d = await decideScan(
        tx,
        session.orgId,
        { ...body, claimedInvoiceDate: claimed },
        serverTs,
      );

      // Every scan writes a PosScan row whatever the verdict (SPEC §5.6).
      await tx.posScan.create({
        data: {
          orgId: session.orgId,
          rawManufacturerRef: body.manufacturerRef,
          rawBatchNo: body.batchNo,
          batchId: d.batch?.id ?? null,
          qty: body.qty,
          context: body.context,
          claimedInvoiceDate: claimed,
          verdict: d.verdict,
          alertCode: d.alertCode,
          serverTs,
        },
      });

      if (d.verdict === ScanVerdict.BLOCK && d.alertCode && d.severity) {
        await tx.alert.create({
          data: {
            code: d.alertCode,
            severity: d.severity,
            batchId: d.batch?.id ?? null,
            orgId: session.orgId,
            payload: {
              ...(d.detail ?? {}),
              scannedBy: session.orgId,
              manufacturerRef: body.manufacturerRef,
              batchNo: body.batchNo,
              qty: body.qty,
              context: body.context,
            } as never,
          },
        });
      }

      for (const a of d.secondaryAlerts) {
        await tx.alert.create({
          data: {
            code: a.code,
            severity: a.severity,
            batchId: d.batch?.id ?? null,
            orgId: session.orgId,
            payload: { ...(a.detail ?? {}), primaryVerdict: d.verdict } as never,
          },
        });
      }

      // Compliance receipt for this decision, in the same transaction as the
      // audit event that proves it. Raised for BOTH outcomes: an ALLOW produces
      // an OK receipt, a BLOCK produces an EXPIRED one. A POS decision has no
      // return behind it, so returnRequestId is null.
      let billStatus: string | null = null;
      let anomalyNote: string | null = null;
      if (d.batch) {
        const audit = await appendAudit(tx, {
          entityType: "PosScan",
          entityId: d.batch.id,
          action: `SCAN:${d.verdict}${d.alertCode ? `:${d.alertCode}` : ""}`,
          actorUserId: session.userId,
          actorOrgId: session.orgId,
          payload: {
            batchId: d.batch.id,
            batchNo: d.batch.batchNo,
            context: body.context,
            qty: body.qty,
            verdict: d.verdict,
            alertCode: d.alertCode,
          } as never,
        });

        const bill = buildBillPayload(
          { batchId: d.batch.id, returnRequestId: null, quantity: body.qty },
          {
            alerts: [
              ...(d.alertCode ? [d.alertCode] : []),
              ...d.secondaryAlerts.map((a) => a.code),
            ],
            expired: new Date(d.batch.expiryDate).getTime() < serverTs.getTime(),
          },
        );

        await tx.bill.create({
          data: {
            returnRequestId: null,
            batchId: bill.batchId,
            quantity: bill.quantity,
            status: bill.status,
            anomalyCodes: bill.anomalyCodes,
            anomalyNote: bill.anomalyNote,
            auditEventId: audit.id,
          },
        });
        billStatus = bill.status;
        anomalyNote = bill.anomalyNote;
      }

      return { ...d, billStatus, anomalyNote };
    });

    const payload = {
      verdict: decision.verdict,
      alertCode: decision.alertCode,
      severity: decision.severity,
      message: decision.message,
      batch: decision.batch,
      secondaryAlerts: decision.secondaryAlerts,
      // The compliance receipt. An EXPIRED receipt hard-blocks the terminal;
      // there is no override, for any role.
      bill: decision.billStatus
        ? { status: decision.billStatus, anomalyNote: decision.anomalyNote }
        : null,
      serverTs: serverTs.toISOString(),
    };
    await idem.record(200, payload);
    return ok(payload);
  } catch (e) {
    return toResponse(e);
  }
}
