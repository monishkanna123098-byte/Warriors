import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { ok, toResponse } from "@/lib/http";
import { Role, Severity } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Role-scoped alert feed, a sibling of the regulator-only /api/regulator/alerts
 * named in SPEC §5.
 *
 * A manufacturer sees findings on its own batches; the cross-organisation view
 * stays with the regulator. Without this a manufacturer's "alerts on my batches"
 * screen (§6.3) has no endpoint it is allowed to call.
 */
export async function GET(req: Request) {
  try {
    const s = await requireSession();
    const severity = new URL(req.url).searchParams.get("severity");

    const scope =
      s.role === Role.REGULATOR
        ? {}
        : s.role === Role.MANUFACTURER
          ? { batch: { manufacturerId: s.orgId } }
          : { orgId: s.orgId };

    const rows = await prisma.alert.findMany({
      where: { ...scope, ...(severity && severity in Severity ? { severity: severity as Severity } : {}) },
      include: { batch: { include: { manufacturer: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    const orgIds = Array.from(new Set(rows.map((r) => r.orgId).filter((x): x is string => !!x)));
    const orgs = await prisma.organization.findMany({ where: { id: { in: orgIds } } });
    const orgById = new Map(orgs.map((o) => [o.id, o.name]));

    return ok({
      items: rows.map((a) => ({
        id: a.id,
        code: a.code,
        severity: a.severity,
        batchId: a.batchId,
        batchNo: a.batch?.batchNo ?? null,
        manufacturer: a.batch?.manufacturer.name ?? null,
        orgName: a.orgId ? (orgById.get(a.orgId) ?? null) : null,
        payload: a.payload,
        acknowledgedAt: a.acknowledgedAt?.toISOString() ?? null,
        createdAt: a.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    return toResponse(e);
  }
}
