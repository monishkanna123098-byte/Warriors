import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { ok, toResponse } from "@/lib/http";
import { ReturnState, Role } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const s = await requireRole(Role.DISTRIBUTOR);
    const rows = await prisma.returnRequest.findMany({
      where: {
        distributorId: s.orgId,
        state: { in: [ReturnState.INITIATED, ReturnState.PICKUP_ASSIGNED] },
      },
      include: {
        batch: { include: { product: true, manufacturer: true } },
        retailer: true,
      },
      orderBy: { dueBy: "asc" },
    });

    return ok({
      items: rows.map((r) => ({
        id: r.id,
        state: r.state,
        batchNo: r.batch.batchNo,
        batchId: r.batchId,
        product: r.batch.product.name,
        unitWeightG: r.batch.product.unitWeightG,
        manufacturer: r.batch.manufacturer.name,
        retailer: r.retailer.name,
        retailerLicenseNo: r.retailer.licenseNo,
        declaredQty: r.declaredQty,
        condition: r.condition,
        photoUrl: r.photoUrl,
        initiatedAt: r.initiatedAt?.toISOString() ?? null,
        pickupAt: r.pickupAt?.toISOString() ?? null,
        dueBy: r.dueBy.toISOString(),
      })),
    });
  } catch (e) {
    return toResponse(e);
  }
}
