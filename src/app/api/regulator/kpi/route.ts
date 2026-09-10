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

    const [openCritical, leakage, overdue, destroyed, totalAlerts, expiredBills, nsqMatched] =
      await Promise.all([
      prisma.alert.count({ where: { severity: Severity.CRITICAL, acknowledgedAt: null } }),
      prisma.leakageRecord.aggregate({
        _sum: { leakedQty: true },
        where: { status: LeakageStatus.OPEN },
      }),
      prisma.returnRequest.count({ where: { state: ReturnState.RETURN_DUE, dueBy: { lt: now } } }),
      prisma.batch.count({ where: { registryStatus: RegistryStatus.DESTROYED } }),
      prisma.alert.count(),
      prisma.bill.count({ where: { status: "EXPIRED" } }),
      prisma.nsqAlert.count(),
    ]);

    return ok({
      serverTs: now.toISOString(),
      openCriticalAlerts: openCritical,
      unaccountedUnits: leakage._sum.leakedQty ?? 0,
      overdueReturns: overdue,
      batchesDestroyed: destroyed,
      totalAlerts,
      /// Batches refused at a decision point, each with a permanent receipt.
      expiredReceipts: expiredBills,
      /// CDSCO not-of-standard-quality alerts on file. A separate signal.
      nsqAlerts: nsqMatched,
    });
  } catch (e) {
    return toResponse(e);
  }
}
