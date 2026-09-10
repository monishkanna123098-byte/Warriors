import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { ok, toResponse } from "@/lib/http";
import { ReturnState, Role } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const s = await requireRole(Role.MANUFACTURER);
    const rows = await prisma.returnRequest.findMany({
      where: {
        manufacturerId: s.orgId,
        state: {
          in: [
            ReturnState.DISTRIBUTOR_RECEIVED,
            ReturnState.MANUFACTURER_RECEIVED,
            ReturnState.DISPOSAL_SCHEDULED,
            ReturnState.FACILITY_RECEIVED,
          ],
        },
      },
      include: {
        batch: { include: { product: true } },
        retailer: true,
        distributor: true,
        disposals: { include: { certificates: true } },
      },
      orderBy: { updatedAt: "desc" },
    });

    return ok({
      items: rows.map((r) => ({
        id: r.id,
        state: r.state,
        batchId: r.batchId,
        batchNo: r.batch.batchNo,
        product: r.batch.product.name,
        retailer: r.retailer.name,
        distributor: r.distributor.name,
        declaredQty: r.declaredQty,
        distReceivedQty: r.distReceivedQty,
        mfgReceivedQty: r.mfgReceivedQty,
        confirmedQty: r.confirmedQty,
        distReceivedAt: r.distReceivedAt?.toISOString() ?? null,
        disposals: r.disposals.map((d) => ({
          id: d.id,
          qty: d.qty,
          facilityId: d.facilityId,
          scheduledDate: d.scheduledDate.toISOString(),
          facilityReceivedAt: d.facilityReceivedAt?.toISOString() ?? null,
          certifiedQty: d.certificates.reduce((a, c) => a + c.qty, 0),
        })),
      })),
    });
  } catch (e) {
    return toResponse(e);
  }
}
