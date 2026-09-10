import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { ok, parseBody, toResponse, withIdempotency } from "@/lib/http";
import { decideScan } from "@/lib/pos";
import { ScanContext, ScanVerdict } from "@/lib/types";

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

      return d;
    });

    const payload = {
      verdict: decision.verdict,
      alertCode: decision.alertCode,
      severity: decision.severity,
      message: decision.message,
      batch: decision.batch,
      secondaryAlerts: decision.secondaryAlerts,
      serverTs: serverTs.toISOString(),
    };
    await idem.record(200, payload);
    return ok(payload);
  } catch (e) {
    return toResponse(e);
  }
}
