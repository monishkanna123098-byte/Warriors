import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { ok, parseBody, toResponse, withIdempotency } from "@/lib/http";
import { executeTransfer, transferDestinations } from "@/lib/transfer";
import { Role } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Transfers this organisation sent or received, plus where it can dispatch to. */
export async function GET() {
  try {
    const s = await requireRole(
      Role.MANUFACTURER,
      Role.DISTRIBUTOR,
      Role.RETAILER,
      Role.REGULATOR,
    );

    const where =
      s.role === Role.REGULATOR ? {} : { OR: [{ fromOrgId: s.orgId }, { toOrgId: s.orgId }] };

    const [rows, destinations] = await Promise.all([
      prisma.transfer.findMany({
        where,
        include: {
          fromOrg: true,
          toOrg: true,
          batch: { include: { product: true, manufacturer: true } },
        },
        orderBy: { serverTs: "desc" },
        take: 100,
      }),
      s.role === Role.REGULATOR ? Promise.resolve([]) : transferDestinations(prisma, s.orgId),
    ]);

    return ok({
      items: rows.map((t) => ({
        id: t.id,
        batchId: t.batchId,
        batchNo: t.batch.batchNo,
        product: t.batch.product.name,
        manufacturer: t.batch.manufacturer.name,
        from: t.fromOrg.name,
        fromOrgId: t.fromOrgId,
        to: t.toOrg.name,
        toOrgId: t.toOrgId,
        qty: t.qty,
        authorized: t.authorized,
        direction: t.fromOrgId === s.orgId ? "OUT" : "IN",
        note: t.note,
        serverTs: t.serverTs.toISOString(),
      })),
      // Each destination carries whether an authorised route covers it, so the
      // picker can offer it and say what will happen — rather than hiding it.
      destinations,
    });
  } catch (e) {
    return toResponse(e);
  }
}

const Body = z.object({
  batchId: z.string().min(1),
  toOrgId: z.string().min(1),
  qty: z.number().int().positive(),
  note: z.string().max(500).optional().nullable(),
});

/**
 * Moves stock between organisations.
 *
 * This is the route whose absence made the retail leg seed-only: nothing else in
 * the application writes a SUPPLIED ledger row, and without one a retailer's
 * supply headroom is zero, so raiseDueReturns() raises nothing and I3 refuses
 * every return. See src/lib/transfer.ts.
 */
export async function POST(req: Request) {
  try {
    const session = await requireRole(Role.MANUFACTURER, Role.DISTRIBUTOR, Role.RETAILER);
    const body = await parseBody(req, Body);

    const idem = await withIdempotency(req, session.userId, "POST /api/transfers", body);
    if (idem.replay) return idem.replay;

    const result = await prisma.$transaction((tx) =>
      executeTransfer(tx, { userId: session.userId, orgId: session.orgId }, body),
    );

    await idem.record(200, result);
    return ok(result);
  } catch (e) {
    return toResponse(e);
  }
}
