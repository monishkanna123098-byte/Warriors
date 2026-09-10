import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { ok, toResponse } from "@/lib/http";
import { allocatedForBatch } from "@/lib/ledger";
import { Role } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const s = await requireRole(Role.FACILITY);
    const rows = await prisma.disposalRequest.findMany({
      where: { facilityId: s.orgId },
      include: {
        return: { include: { batch: { include: { product: true, manufacturer: true } } } },
        certificates: true,
      },
      orderBy: { scheduledDate: "asc" },
    });

    const items = await Promise.all(
      rows.map(async (d) => {
        const confirmedQty = d.return.confirmedQty ?? 0;
        const alreadyAllocated = await allocatedForBatch(prisma, d.batchId);
        return {
          id: d.id,
          returnId: d.returnId,
          returnState: d.return.state,
          batchId: d.batchId,
          batchNo: d.return.batch.batchNo,
          product: d.return.batch.product.name,
          manufacturer: d.return.batch.manufacturer.name,
          qty: d.qty,
          scheduledDate: d.scheduledDate.toISOString(),
          facilityReceivedAt: d.facilityReceivedAt?.toISOString() ?? null,
          registryStatus: d.return.batch.registryStatus,
          // The I4 terms, shown before submit so the facility sees the ceiling
          // it is working against (SPEC §6.4).
          confirmedQty,
          alreadyAllocated,
          eligible: confirmedQty - alreadyAllocated,
          certificates: d.certificates.map((c) => ({
            id: c.id,
            certNo: c.certNo,
            qty: c.qty,
            issuedAt: c.issuedAt.toISOString(),
          })),
        };
      }),
    );

    return ok({ items });
  } catch (e) {
    return toResponse(e);
  }
}
