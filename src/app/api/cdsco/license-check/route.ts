import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { fail, ok, toResponse } from "@/lib/http";
import { checkLicenseStatus } from "@/lib/cdsco";

export const dynamic = "force-dynamic";

/**
 * Is a licence number an ACTIVE CDSCO-licensed entity?
 *
 * Authenticated, unlike the NSQ check: this is trading-partner due diligence
 * rather than public-safety information.
 *
 * The answer is NOT the same as RCCP's own authorised-relationship check, and
 * callers must keep the two labelled distinctly — see the note in the response.
 */
export async function GET(req: Request) {
  try {
    await requireSession();
    const licenseNo = new URL(req.url).searchParams.get("licenseNo");
    if (!licenseNo) {
      return fail(400, "VALIDATION_ERROR", "licenseNo is required");
    }

    const rows = await prisma.licensedEntity.findMany({ where: { licenseNo } });
    const result = checkLicenseStatus(licenseNo, rows);

    return ok({
      ...result,
      signal: "CDSCO_LICENCE",
      note: "\"Not CDSCO-licensed\" is a different finding from \"not an authorised relationship in RCCP\". Do not present them as one status.",
    });
  } catch (e) {
    return toResponse(e);
  }
}
