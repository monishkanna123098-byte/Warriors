import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { ok, toResponse } from "@/lib/http";
import { OrgType } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Directory lookup — the manufacturer's disposal form needs a facility picker,
 * the regulator's views need names. Read-only and non-sensitive: licence numbers
 * are public register data.
 */
export async function GET(req: Request) {
  try {
    await requireSession();
    const type = new URL(req.url).searchParams.get("type");
    const rows = await prisma.organization.findMany({
      where: type && type in OrgType ? { type: type as OrgType } : {},
      orderBy: { name: "asc" },
    });
    return ok({
      items: rows.map((o) => ({
        id: o.id,
        name: o.name,
        type: o.type,
        licenseNo: o.licenseNo,
        district: o.district,
        stateCode: o.stateCode,
        mappedDistributorId: o.mappedDistributorId,
      })),
    });
  } catch (e) {
    return toResponse(e);
  }
}
