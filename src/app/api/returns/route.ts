import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { ok, toResponse } from "@/lib/http";
import { LEGAL_TRANSITIONS } from "@/lib/lifecycle";
import { ReturnState } from "@/lib/types";

export const dynamic = "force-dynamic";

const ORDER: ReturnState[] = [
  ReturnState.RETURN_DUE,
  ReturnState.INITIATED,
  ReturnState.PICKUP_ASSIGNED,
  ReturnState.DISTRIBUTOR_RECEIVED,
  ReturnState.MANUFACTURER_RECEIVED,
  ReturnState.DISPOSAL_SCHEDULED,
  ReturnState.FACILITY_RECEIVED,
  ReturnState.CERTIFIED_DESTROYED,
];

export async function GET() {
  try {
    const s = await requireSession();

    const rows = await prisma.returnRequest.findMany({
      where: {
        OR: [{ retailerId: s.orgId }, { distributorId: s.orgId }, { manufacturerId: s.orgId }],
      },
      include: {
        batch: { include: { product: true, manufacturer: true } },
        leakage: true,
        disposals: { include: { certificates: true } },
      },
      orderBy: { updatedAt: "desc" },
    });

    return ok({
      items: rows.map((r) => {
        const reached = ORDER.indexOf(r.state as ReturnState);
        return {
          id: r.id,
          state: r.state,
          nextStates: LEGAL_TRANSITIONS[r.state as ReturnState],
          batchNo: r.batch.batchNo,
          product: r.batch.product.name,
          manufacturer: r.batch.manufacturer.name,
          registryStatus: r.batch.registryStatus,
          declaredQty: r.declaredQty,
          distReceivedQty: r.distReceivedQty,
          mfgReceivedQty: r.mfgReceivedQty,
          confirmedQty: r.confirmedQty,
          dueBy: r.dueBy.toISOString(),
          condition: r.condition,
          photoUrl: r.photoUrl,
          timeline: ORDER.map((st, i) => ({ state: st, reached: i <= reached })),
          leakage: r.leakage.map((l) => ({
            id: l.id,
            leakedQty: l.leakedQty,
            declaredQty: l.declaredQty,
            receivedQty: l.receivedQty,
            status: l.status,
          })),
          certificates: r.disposals.flatMap((d) =>
            d.certificates.map((c) => ({ id: c.id, certNo: c.certNo, qty: c.qty })),
          ),
        };
      }),
    });
  } catch (e) {
    return toResponse(e);
  }
}
