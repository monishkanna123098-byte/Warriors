import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { ok, parseBody, toResponse } from "@/lib/http";
import { appendAudit } from "@/lib/audit";
import { resolveBatch } from "@/lib/pos";
import { AlertCode, CitizenReportReason, Role, Severity } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Regulator's inbox of public reports. */
export async function GET() {
  try {
    await requireRole(Role.REGULATOR);
    const rows = await prisma.citizenReport.findMany({
      include: { batch: { include: { product: true, manufacturer: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    return ok({
      items: rows.map((r) => ({
        id: r.id,
        batchId: r.batchId,
        resolved: r.batchId !== null,
        batchNo: r.batch?.batchNo ?? r.rawBatchNo,
        product: r.batch?.product.name ?? null,
        manufacturer: r.batch?.manufacturer.name ?? null,
        rawManufacturerRef: r.rawManufacturerRef,
        rawBatchNo: r.rawBatchNo,
        reason: r.reason,
        description: r.description,
        pharmacyLicenseNo: r.pharmacyLicenseNo,
        location: r.location,
        createdAt: r.createdAt.toISOString(),
      })),
      count: rows.length,
      unresolved: rows.filter((r) => r.batchId === null).length,
      caveat:
        "A citizen report is EVIDENCE, not a finding. It never changes a batch's status on its own.",
    });
  } catch (e) {
    return toResponse(e);
  }
}

const Body = z.object({
  manufacturerRef: z.string().min(1).max(120),
  batchNo: z.string().min(1).max(120),
  reason: z.enum([
    CitizenReportReason.SUSPECTED_EXPIRED,
    CitizenReportReason.SUSPECTED_COUNTERFEIT,
    CitizenReportReason.PACKAGING_TAMPERED,
    CitizenReportReason.ADVERSE_REACTION,
    CitizenReportReason.SOLD_AFTER_RECALL,
    CitizenReportReason.OTHER,
  ]),
  description: z.string().max(2000).optional().nullable(),
  pharmacyLicenseNo: z.string().max(120).optional().nullable(),
  location: z.string().max(200).optional().nullable(),
});

/**
 * PUBLIC. Anyone may report a medicine, with no account (Phase 14/19).
 *
 * The report is recorded as EVIDENCE and nothing more. It writes no ledger row,
 * touches no batch status, and no code path downstream may treat it as proof —
 * a system where a stranger's form submission could condemn a manufacturer's
 * batch would be trivially weaponised.
 *
 * A batch that does not resolve is still recorded, with batchId null. An
 * unreadable or invented batch number is the single most valuable report there
 * is; rejecting it for failing to match would discard exactly the counterfeit
 * signal the report exists to raise.
 */
export async function POST(req: Request) {
  try {
    const body = await parseBody(req, Body);

    const result = await prisma.$transaction(async (tx) => {
      const batch = await resolveBatch(tx, body.manufacturerRef, body.batchNo);

      const audit = await appendAudit(tx, {
        // The audited entity is the BATCH the report is about, not the report
        // row — which does not exist yet, and whose id would be meaningless in
        // the chain anyway. An unresolved report is keyed by what was typed, so
        // repeat reports of the same invented batch number cluster together.
        entityType: "Batch",
        entityId: batch?.id ?? `UNRESOLVED:${body.batchNo.trim().toUpperCase()}`,
        action: "CITIZEN_REPORTED",
        actorUserId: null,
        actorOrgId: null,
        payload: {
          rawManufacturerRef: body.manufacturerRef,
          rawBatchNo: body.batchNo,
          reason: body.reason,
          resolvedBatchId: batch?.id ?? null,
        },
      });

      const report = await tx.citizenReport.create({
        data: {
          batchId: batch?.id ?? null,
          rawManufacturerRef: body.manufacturerRef,
          rawBatchNo: body.batchNo,
          reason: body.reason,
          description: body.description ?? null,
          pharmacyLicenseNo: body.pharmacyLicenseNo ?? null,
          location: body.location ?? null,
          auditEventId: audit.id,
        },
      });

      // Surfaced in the regulator's feed at LOW severity. Severity here is a
      // queue position, not a judgement about the batch.
      await tx.alert.create({
        data: {
          code: AlertCode.CITIZEN_REPORT,
          severity: Severity.LOW,
          batchId: batch?.id ?? null,
          orgId: null,
          payload: {
            reason: body.reason,
            rawBatchNo: body.batchNo,
            resolved: batch !== null,
            reportId: report.id,
          } as never,
        },
      });

      return {
        id: report.id,
        reference: report.id.slice(-8).toUpperCase(),
        batchResolved: batch !== null,
        createdAt: report.createdAt.toISOString(),
      };
    });

    return ok({
      ...result,
      message:
        "Thank you. Your report has been recorded and passed to the regulator. It is treated as evidence for them to look into, not as a finding against the medicine.",
    });
  } catch (e) {
    return toResponse(e);
  }
}
