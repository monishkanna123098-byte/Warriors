import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { ok, toResponse } from "@/lib/http";
import { billHeadline, BillStatus } from "@/lib/billing";
import { Role } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET only, by design. Bills are permanent compliance receipts: there is no
 * PATCH, PUT or DELETE route for them anywhere in this codebase, and there never
 * will be. A correction is a new Bill, never an edit of an old one.
 */
export async function GET(req: Request) {
  try {
    const s = await requireSession();
    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const batchId = url.searchParams.get("batchId");

    // A manufacturer sees receipts on its own batches; everyone else sees the
    // receipts their own organisation was party to. The regulator sees all.
    const scope =
      s.role === Role.REGULATOR
        ? {}
        : s.role === Role.MANUFACTURER
          ? { batch: { manufacturerId: s.orgId } }
          : {
              OR: [
                { returnRequest: { retailerId: s.orgId } },
                { returnRequest: { distributorId: s.orgId } },
                { returnRequest: { manufacturerId: s.orgId } },
                { batch: { inventory: { some: { orgId: s.orgId } } } },
              ],
            };

    const rows = await prisma.bill.findMany({
      where: {
        ...scope,
        ...(status === BillStatus.OK || status === BillStatus.EXPIRED ? { status } : {}),
        ...(batchId ? { batchId } : {}),
      },
      include: { batch: { include: { product: true, manufacturer: true } } },
      orderBy: { generatedAt: "desc" },
      take: 300,
    });

    const expiredCount = rows.filter((b) => b.status === BillStatus.EXPIRED).length;

    return ok({
      total: rows.length,
      expiredCount,
      items: rows.map((b) => ({
        id: b.id,
        status: b.status,
        headline: billHeadline(b.status, b.anomalyCodes),
        anomalyCodes: b.anomalyCodes,
        anomalyNote: b.anomalyNote,
        quantity: b.quantity,
        generatedAt: b.generatedAt.toISOString(),
        batchId: b.batchId,
        batchNo: b.batch.batchNo,
        product: b.batch.product.name,
        manufacturer: b.batch.manufacturer.name,
        manufacturerLicenseNo: b.batch.manufacturer.licenseNo,
        registryStatus: b.batch.registryStatus,
        // Present for a return-driven receipt, null for a POS decision.
        returnRequestId: b.returnRequestId,
        source: b.returnRequestId ? "RETURN" : "POS",
      })),
    });
  } catch (e) {
    return toResponse(e);
  }
}
