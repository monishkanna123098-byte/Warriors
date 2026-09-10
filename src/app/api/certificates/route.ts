import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { ok, parseBody, toResponse } from "@/lib/http";
import { runTransition } from "@/lib/route-helpers";
import { forbidden, notFound } from "@/lib/errors";
import { ReturnState, Role } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const s = await requireRole(Role.FACILITY, Role.MANUFACTURER, Role.REGULATOR);
    const where =
      s.role === Role.FACILITY
        ? { facilityId: s.orgId }
        : s.role === Role.MANUFACTURER
          ? { batch: { manufacturerId: s.orgId } }
          : {};

    const rows = await prisma.destructionCertificate.findMany({
      where,
      include: { batch: { include: { manufacturer: true, product: true } } },
      orderBy: { issuedAt: "desc" },
    });

    return ok({
      items: rows.map((c) => ({
        id: c.id,
        certNo: c.certNo,
        qty: c.qty,
        batchId: c.batchId,
        batchNo: c.batch.batchNo,
        product: c.batch.product.name,
        manufacturer: c.batch.manufacturer.name,
        registryStatus: c.batch.registryStatus,
        issuedAt: c.issuedAt.toISOString(),
      })),
    });
  } catch (e) {
    return toResponse(e);
  }
}

const Body = z.object({
  disposalRequestId: z.string().min(1),
  qty: z.number().int().positive(),
});

/**
 * I4 breach -> 409 CERTIFICATE_OVER_ALLOCATION, and because the check runs inside
 * the transaction in lifecycle.ts, no certificate row survives the rejection.
 * That is acceptance A6 and it is the whole point of the screen.
 */
export async function POST(req: Request) {
  try {
    const session = await requireRole(Role.FACILITY);
    const body = await parseBody(req, Body);

    const dr = await prisma.disposalRequest.findUnique({ where: { id: body.disposalRequestId } });
    if (!dr) throw notFound(`Disposal request ${body.disposalRequestId} not found`);
    if (dr.facilityId !== session.orgId) {
      throw forbidden("This disposal is assigned to another facility");
    }

    return await runTransition({
      req,
      session,
      returnId: dr.returnId,
      ownerField: null, // authorised above against DisposalRequest.facilityId
      targetState: ReturnState.CERTIFIED_DESTROYED,
      endpoint: "POST /api/certificates",
      body,
      payload: {
        to: ReturnState.CERTIFIED_DESTROYED,
        disposalRequestId: body.disposalRequestId,
        qty: body.qty,
      },
    });
  } catch (e) {
    return toResponse(e);
  }
}
