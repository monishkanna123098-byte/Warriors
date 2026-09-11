import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { ok, toResponse } from "@/lib/http";
import { checkStageStall } from "@/lib/invariants";
import { ReturnState, Role } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * I8 — returns that stopped moving.
 *
 * The failure here is an ABSENT event, not a refused one. Nothing in I1-I6 fires
 * because nothing happened, which is exactly the state a party that does not want
 * stock reconciled would choose. `updatedAt` is the server's own timestamp for
 * the last transition (CLAUDE.md rule 5).
 */
export async function GET() {
  try {
    const s = await requireRole(Role.REGULATOR, Role.MANUFACTURER, Role.DISTRIBUTOR);
    const serverNow = new Date();

    const where =
      s.role === Role.REGULATOR
        ? { state: { not: ReturnState.CERTIFIED_DESTROYED } }
        : s.role === Role.MANUFACTURER
          ? { state: { not: ReturnState.CERTIFIED_DESTROYED }, manufacturerId: s.orgId }
          : { state: { not: ReturnState.CERTIFIED_DESTROYED }, distributorId: s.orgId };

    const rows = await prisma.returnRequest.findMany({
      where,
      include: {
        batch: { include: { product: true, manufacturer: true } },
        retailer: true,
        distributor: true,
        manufacturer: true,
        // The facility is NOT a party on ReturnRequest — it becomes involved
        // only when a disposal is scheduled — so without this a stall waiting on
        // the facility named nobody, which is the one thing this screen exists
        // to do.
        disposals: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: { updatedAt: "asc" },
    });

    // Resolve the facility named on the most recent disposal for each return.
    const facilityIds = [...new Set(rows.map((r) => r.disposals[0]?.facilityId).filter(Boolean))] as string[];
    const facilities = facilityIds.length
      ? await prisma.organization.findMany({ where: { id: { in: facilityIds } } })
      : [];
    const facilityById = new Map(facilities.map((f) => [f.id, f]));

    const owner = {
      RETAILER: (r: (typeof rows)[number]) => r.retailer,
      DISTRIBUTOR: (r: (typeof rows)[number]) => r.distributor,
      MANUFACTURER: (r: (typeof rows)[number]) => r.manufacturer,
      FACILITY: (r: (typeof rows)[number]) => {
        const id = r.disposals[0]?.facilityId;
        return id ? (facilityById.get(id) ?? null) : null;
      },
    } as const;

    const items = rows
      .map((r) => {
        const stall = checkStageStall({
          state: r.state as ReturnState,
          since: r.updatedAt,
          serverNow,
        });
        const org = stall.owedBy ? owner[stall.owedBy as keyof typeof owner](r) : null;
        return {
          returnId: r.id,
          batchId: r.batchId,
          batchNo: r.batch.batchNo,
          product: r.batch.product.name,
          manufacturer: r.batch.manufacturer.name,
          // The quantity actually at stake: what has been confirmed so far, or
          // what the retailer declared if nothing is confirmed yet.
          qty: r.confirmedQty ?? r.declaredQty ?? 0,
          state: r.state,
          stalled: stall.stalled,
          elapsedDays: stall.elapsedDays,
          slaDays: stall.slaDays,
          overdueDays: stall.overdueDays,
          deadline: stall.deadline?.toISOString() ?? null,
          expectedNext: stall.expectedNext,
          owedByRole: stall.owedBy,
          owedByOrg: org?.name ?? null,
          owedByLicenseNo: org?.licenseNo ?? null,
          severity: stall.severity ?? null,
          since: r.updatedAt.toISOString(),
          dueBy: r.dueBy.toISOString(),
        };
      })
      .sort((a, b) => Number(b.stalled) - Number(a.stalled) || b.overdueDays - a.overdueDays);

    return ok({
      items,
      stalled: items.filter((i) => i.stalled).length,
      inFlight: items.length,
      serverNow: serverNow.toISOString(),
    });
  } catch (e) {
    return toResponse(e);
  }
}
