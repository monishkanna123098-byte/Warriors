import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { ok, toResponse } from "@/lib/http";
import { LeakageStatus, Role } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Leakage grouped by organisation. Recurring leakage against one (from, to) pair
 * is the fraud signal — a single shortfall is noise, a pattern is not.
 */
export async function GET() {
  try {
    await requireRole(Role.REGULATOR);

    const rows = await prisma.leakageRecord.findMany({
      include: { return: { include: { batch: true } } },
      orderBy: { createdAt: "desc" },
    });

    const orgIds = Array.from(new Set(rows.flatMap((r) => [r.fromOrgId, r.toOrgId])));
    const orgs = await prisma.organization.findMany({ where: { id: { in: orgIds } } });
    const orgById = new Map(orgs.map((o) => [o.id, o]));

    const groups = new Map<
      string,
      {
        fromOrgId: string;
        fromOrg: string;
        toOrgId: string;
        toOrg: string;
        district: string;
        records: number;
        openRecords: number;
        totalLeakedQty: number;
        openLeakedQty: number;
      }
    >();

    for (const r of rows) {
      const key = `${r.fromOrgId}->${r.toOrgId}`;
      const g = groups.get(key) ?? {
        fromOrgId: r.fromOrgId,
        fromOrg: orgById.get(r.fromOrgId)?.name ?? r.fromOrgId,
        toOrgId: r.toOrgId,
        toOrg: orgById.get(r.toOrgId)?.name ?? r.toOrgId,
        district: orgById.get(r.fromOrgId)?.district ?? "—",
        records: 0,
        openRecords: 0,
        totalLeakedQty: 0,
        openLeakedQty: 0,
      };
      g.records += 1;
      g.totalLeakedQty += r.leakedQty;
      if (r.status === LeakageStatus.OPEN) {
        g.openRecords += 1;
        g.openLeakedQty += r.leakedQty;
      }
      groups.set(key, g);
    }

    const totalUnaccounted = rows
      .filter((r) => r.status === LeakageStatus.OPEN)
      .reduce((a, r) => a + r.leakedQty, 0);

    return ok({
      totalUnaccounted,
      groups: Array.from(groups.values()).sort((a, b) => b.openLeakedQty - a.openLeakedQty),
      records: rows.map((r) => ({
        id: r.id,
        returnId: r.returnId,
        batchId: r.batchId,
        batchNo: r.return.batch.batchNo,
        fromOrg: orgById.get(r.fromOrgId)?.name ?? r.fromOrgId,
        toOrg: orgById.get(r.toOrgId)?.name ?? r.toOrgId,
        declaredQty: r.declaredQty,
        receivedQty: r.receivedQty,
        leakedQty: r.leakedQty,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    return toResponse(e);
  }
}
