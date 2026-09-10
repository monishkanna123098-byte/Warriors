import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { ok, toResponse } from "@/lib/http";
import { Role } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Listing of the imported CDSCO reference data, for the regulator's view.
 *
 * Read-only. Both tables are import-only from the app's perspective — the only
 * writer is scripts/import-cdsco.mjs.
 */
export async function GET() {
  try {
    await requireRole(Role.REGULATOR);

    const [nsq, entities, batches] = await Promise.all([
      prisma.nsqAlert.findMany({ orderBy: { dateFlagged: "desc" } }),
      prisma.licensedEntity.findMany({ orderBy: { name: "asc" } }),
      prisma.batch.findMany({ include: { product: true, manufacturer: true } }),
    ]);

    // Which NSQ alerts correspond to stock this system actually tracks? That
    // intersection is what a regulator acts on first.
    const nsqKeys = new Set(nsq.map((n) => `${n.medicineName.toUpperCase()}|${n.batchNo.toUpperCase()}`));
    const matchedBatches = batches
      .filter((b) => nsqKeys.has(`${b.product.name.toUpperCase()}|${b.batchNo.toUpperCase()}`))
      .map((b) => ({
        batchId: b.id,
        batchNo: b.batchNo,
        product: b.product.name,
        manufacturer: b.manufacturer.name,
        registryStatus: b.registryStatus,
      }));

    return ok({
      nsq: {
        total: nsq.length,
        matchedInRccp: matchedBatches.length,
        matchedBatches,
        items: nsq.map((n) => ({
          id: n.id,
          medicineName: n.medicineName,
          batchNo: n.batchNo,
          dateFlagged: n.dateFlagged.toISOString(),
          reason: n.reason,
          source: n.source,
          importedAt: n.importedAt.toISOString(),
          trackedHere: nsqKeys.has(`${n.medicineName.toUpperCase()}|${n.batchNo.toUpperCase()}`)
            ? matchedBatches.some((m) => m.batchNo.toUpperCase() === n.batchNo.toUpperCase())
            : false,
        })),
      },
      entities: {
        total: entities.length,
        notActive: entities.filter((e) => e.status !== "ACTIVE").length,
        items: entities.map((e) => ({
          id: e.id,
          name: e.name,
          licenseNo: e.licenseNo,
          type: e.type,
          state: e.state,
          status: e.status,
          importedAt: e.importedAt.toISOString(),
        })),
      },
    });
  } catch (e) {
    return toResponse(e);
  }
}
