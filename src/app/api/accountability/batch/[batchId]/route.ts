import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { ok, toResponse } from "@/lib/http";
import { notFound } from "@/lib/errors";
import { batchAccount } from "@/lib/accountability";
import { Role } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * The regulator's central question for one batch: of what was issued, how much
 * was sold, how much is outstanding, how much came back, and where the gap is.
 */
export async function GET(_req: Request, ctx: { params: { batchId: string } }) {
  try {
    const s = await requireSession();
    const account = await batchAccount(prisma, ctx.params.batchId, new Date());
    if (!account) throw notFound(`Batch ${ctx.params.batchId} not found`);

    // A regulator and the batch's own manufacturer see every location. Anyone
    // else sees only their own row: one pharmacy's shortfall is not another
    // pharmacy's business, and the per-location table is commercially sensitive.
    const seesAll =
      s.role === Role.REGULATOR ||
      (s.role === Role.MANUFACTURER && account.manufacturerLicenseNo
        ? await prisma.batch
            .findUnique({ where: { id: ctx.params.batchId }, select: { manufacturerId: true } })
            .then((b) => b?.manufacturerId === s.orgId)
        : false);

    return ok({
      ...account,
      locations: seesAll ? account.locations : account.locations.filter((l) => l.orgId === s.orgId),
      scope: seesAll ? "ALL_LOCATIONS" : "OWN_LOCATION",
    });
  } catch (e) {
    return toResponse(e);
  }
}
