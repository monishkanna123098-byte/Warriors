import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { ok, parseBody, toResponse, withIdempotency } from "@/lib/http";
import { issueHoldOrRecall } from "@/lib/lifecycle";
import { HoldAction, Role } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Every hold, recall and release ever issued — including the lifted ones. */
export async function GET() {
  try {
    await requireRole(Role.REGULATOR, Role.MANUFACTURER, Role.DISTRIBUTOR, Role.RETAILER);

    const rows = await prisma.holdRecallOrder.findMany({
      include: { batch: { include: { manufacturer: true, product: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    return ok({
      items: rows.map((h) => ({
        id: h.id,
        batchId: h.batchId,
        batchNo: h.batch.batchNo,
        product: h.batch.product.name,
        manufacturer: h.batch.manufacturer.name,
        registryStatus: h.batch.registryStatus,
        action: h.action,
        reason: h.reason,
        releasesId: h.releasesId,
        createdAt: h.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    return toResponse(e);
  }
}

const Body = z.object({
  batchId: z.string().min(1),
  action: z.enum([HoldAction.HOLD_ISSUED, HoldAction.RECALL_ISSUED, HoldAction.RELEASED]),
  // Deliberately not optional. An unexplained recall is nearly as damaging as an
  // unexplained release, and the reason is what a manufacturer disputes against.
  reason: z.string().min(8).max(1000),
  releasesId: z.string().optional().nullable(),
});

/**
 * Issues or lifts a hold or recall.
 *
 * REGULATOR only, and only through lifecycle.issueHoldOrRecall — nothing else in
 * the codebase may write Batch.registryStatus (CLAUDE.md rule 2). A release
 * appends a new order rather than editing the old one, so RECALLED -> CLEAN can
 * never happen without an actor, a reason and an audit hash.
 */
export async function POST(req: Request) {
  try {
    const session = await requireRole(Role.REGULATOR);
    const body = await parseBody(req, Body);

    const idem = await withIdempotency(req, session.userId, "POST /api/regulator/holds", body);
    if (idem.replay) return idem.replay;

    const result = await prisma.$transaction((tx) =>
      issueHoldOrRecall(
        tx,
        { userId: session.userId, orgId: session.orgId, role: session.role },
        {
          batchId: body.batchId,
          action: body.action,
          reason: body.reason,
          releasesId: body.releasesId ?? null,
        },
      ),
    );

    await idem.record(200, result);
    return ok(result);
  } catch (e) {
    return toResponse(e);
  }
}
