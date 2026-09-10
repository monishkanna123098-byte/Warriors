import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { ok, toResponse } from "@/lib/http";
import { daysLeft, expiryStateFor } from "@/lib/invariants";
import { Role } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const s = await requireRole(Role.RETAILER, Role.DISTRIBUTOR);
    const now = new Date();

    const rows = await prisma.inventory.findMany({
      where: { orgId: s.orgId },
      include: { batch: { include: { product: true, manufacturer: true } } },
      orderBy: { batch: { expiryDate: "asc" } },
    });

    return ok({
      serverTs: now.toISOString(),
      items: rows.map((r) => ({
        id: r.id,
        qty: r.qty,
        status: r.status,
        batchId: r.batchId,
        batchNo: r.batch.batchNo,
        product: r.batch.product.name,
        form: r.batch.product.form,
        manufacturer: r.batch.manufacturer.name,
        manufacturerLicenseNo: r.batch.manufacturer.licenseNo,
        expiryDate: r.batch.expiryDate.toISOString(),
        registryStatus: r.batch.registryStatus,
        daysLeft: daysLeft(r.batch.expiryDate, now),
        expiryState: expiryStateFor(r.batch.expiryDate, now),
      })),
    });
  } catch (e) {
    return toResponse(e);
  }
}
