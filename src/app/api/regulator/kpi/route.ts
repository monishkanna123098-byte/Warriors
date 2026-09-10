import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { ok, toResponse } from "@/lib/http";
import { LeakageStatus, RegistryStatus, ReturnState, Role, Severity } from "@/lib/types";

export const dynamic = "force-dynamic";

/** The §6.5 KPI row, in one round trip. */
export async function GET() {
  try {
    await requireRole(Role.REGULATOR);
    const now = new Date();

    const [openCritical, leakage, overdue, destroyed, totalAlerts] = await Promise.all([
      prisma.alert.count({ where: { severity: Severity.CRITICAL, acknowledgedAt: null } }),
      prisma.leakageRecord.aggregate({
        _sum: { leakedQty: true },
        where: { status: LeakageStatus.OPEN },
      }),
      prisma.returnRequest.count({ where: { state: ReturnState.RETURN_DUE, dueBy: { lt: now } } }),
      prisma.batch.count({ where: { registryStatus: RegistryStatus.DESTROYED } }),
      prisma.alert.count(),
    ]);

    return ok({
      serverTs: now.toISOString(),
      openCriticalAlerts: openCritical,
      unaccountedUnits: leakage._sum.leakedQty ?? 0,
      overdueReturns: overdue,
      batchesDestroyed: destroyed,
      totalAlerts,
    });
  } catch (e) {
    return toResponse(e);
  }
}
