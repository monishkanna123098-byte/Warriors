import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { ok, toResponse, withIdempotency } from "@/lib/http";
import { appendAudit } from "@/lib/audit";
import { notFound } from "@/lib/errors";
import { Role } from "@/lib/types";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole(Role.REGULATOR);
    const body = { alertId: params.id };

    const idem = await withIdempotency(req, session.userId, "POST /api/alerts/:id/acknowledge", body);
    if (idem.replay) return idem.replay;

    const alert = await prisma.alert.findUnique({ where: { id: params.id } });
    if (!alert) throw notFound(`Alert ${params.id} not found`);

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.alert.update({
        where: { id: params.id },
        data: { acknowledgedById: session.userId, acknowledgedAt: new Date() },
      });
      await appendAudit(tx, {
        entityType: "Alert",
        entityId: params.id,
        action: "ALERT_ACKNOWLEDGED",
        actorUserId: session.userId,
        actorOrgId: session.orgId,
        payload: { code: updated.code, severity: updated.severity } as never,
      });
      return updated;
    });

    // Acknowledging an alert records that a regulator saw it. It does NOT close
    // the underlying LeakageRecord — missing units are never closed by an
    // approval (CLAUDE.md rule 8).
    const payload = {
      id: result.id,
      code: result.code,
      severity: result.severity,
      acknowledgedAt: result.acknowledgedAt?.toISOString() ?? null,
      note: "Acknowledgement records review only; any related leakage stays OPEN.",
    };
    await idem.record(200, payload);
    return ok(payload);
  } catch (e) {
    return toResponse(e);
  }
}
