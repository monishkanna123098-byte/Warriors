import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { ok, toResponse } from "@/lib/http";
import { raiseDueReturns } from "@/lib/lifecycle";
import { DAY_MS } from "@/lib/invariants";
import { ReturnState, Role } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const s = await requireRole(Role.RETAILER);
    const now = new Date();

    // Inventory keeps expiring as real time passes and there is no scheduler in
    // this build, so the due list raises any newly-due returns as it is read.
    // raiseDueReturns is idempotent — it skips batches that already have an open
    // return — but a GET with a write in it is a compromise, not a design: in a
    // real deployment this is a nightly job.
    await prisma.$transaction((tx) => raiseDueReturns(tx, now));

    const rows = await prisma.returnRequest.findMany({
      where: { retailerId: s.orgId, state: ReturnState.RETURN_DUE },
      include: { batch: { include: { product: true, manufacturer: true } }, distributor: true },
      orderBy: { dueBy: "asc" },
    });

    return ok({
      serverTs: now.toISOString(),
      items: rows.map((r) => ({
          id: r.id,
          state: r.state,
          batchId: r.batchId,
          batchNo: r.batch.batchNo,
          product: r.batch.product.name,
          manufacturer: r.batch.manufacturer.name,
          expiryDate: r.batch.expiryDate.toISOString(),
          dueBy: r.dueBy.toISOString(),
          daysToDue: Math.floor((r.dueBy.getTime() - now.getTime()) / DAY_MS),
          overdue: r.dueBy < now,
        distributor: r.distributor.name,
      })),
    });
  } catch (e) {
    return toResponse(e);
  }
}
