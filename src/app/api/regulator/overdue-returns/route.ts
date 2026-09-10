import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { ok, toResponse } from "@/lib/http";
import { DAY_MS } from "@/lib/invariants";
import { ReturnState, Role } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * dueBy < now AND state = RETURN_DUE (SPEC §5).
 *
 * This list is one of the enforcement paths that does not depend on the
 * offender's cooperation: a retailer that simply never initiates a return
 * appears here (SPEC §11.4).
 */
export async function GET() {
  try {
    await requireRole(Role.REGULATOR);
    const now = new Date();

    const rows = await prisma.returnRequest.findMany({
      where: { state: ReturnState.RETURN_DUE, dueBy: { lt: now } },
      include: { batch: { include: { product: true } }, retailer: true, distributor: true },
      orderBy: { dueBy: "asc" },
    });

    const byDistrict = new Map<string, { district: string; count: number; retailers: Set<string> }>();
    for (const r of rows) {
      const d = r.retailer.district;
      const g = byDistrict.get(d) ?? { district: d, count: 0, retailers: new Set<string>() };
      g.count += 1;
      g.retailers.add(r.retailer.name);
      byDistrict.set(d, g);
    }

    return ok({
      serverTs: now.toISOString(),
      total: rows.length,
      byDistrict: Array.from(byDistrict.values())
        .map((g) => ({ district: g.district, count: g.count, retailers: Array.from(g.retailers) }))
        .sort((a, b) => b.count - a.count),
      items: rows.map((r) => ({
        id: r.id,
        batchNo: r.batch.batchNo,
        product: r.batch.product.name,
        retailer: r.retailer.name,
        retailerLicenseNo: r.retailer.licenseNo,
        district: r.retailer.district,
        distributor: r.distributor.name,
        dueBy: r.dueBy.toISOString(),
        daysOverdue: Math.floor((now.getTime() - r.dueBy.getTime()) / DAY_MS),
      })),
    });
  } catch (e) {
    return toResponse(e);
  }
}
