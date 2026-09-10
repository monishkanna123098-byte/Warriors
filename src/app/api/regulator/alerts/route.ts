import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { ok, toResponse } from "@/lib/http";
import { Role, Severity } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireRole(Role.REGULATOR);
    const url = new URL(req.url);
    const severity = url.searchParams.get("severity");
    const acknowledged = url.searchParams.get("acknowledged");

    const rows = await prisma.alert.findMany({
      where: {
        ...(severity && severity in Severity ? { severity: severity as Severity } : {}),
        ...(acknowledged === "false" ? { acknowledgedAt: null } : {}),
        ...(acknowledged === "true" ? { acknowledgedAt: { not: null } } : {}),
      },
      include: { batch: { include: { manufacturer: true } } },
      orderBy: [{ createdAt: "desc" }],
      take: 500,
    });

    const orgIds = Array.from(new Set(rows.map((r) => r.orgId).filter((x): x is string => !!x)));
    const orgs = await prisma.organization.findMany({ where: { id: { in: orgIds } } });
    const orgById = new Map(orgs.map((o) => [o.id, o]));

    return ok({
      items: rows.map((a) => ({
        id: a.id,
        code: a.code,
        severity: a.severity,
        batchId: a.batchId,
        batchNo: a.batch?.batchNo ?? null,
        manufacturer: a.batch?.manufacturer.name ?? null,
        orgId: a.orgId,
        orgName: a.orgId ? (orgById.get(a.orgId)?.name ?? null) : null,
        district: a.orgId ? (orgById.get(a.orgId)?.district ?? null) : null,
        payload: a.payload,
        acknowledgedAt: a.acknowledgedAt?.toISOString() ?? null,
        acknowledgedById: a.acknowledgedById,
        createdAt: a.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    return toResponse(e);
  }
}
