import { prisma } from "@/lib/db";
import { clientIp, fail, ok, rateLimit, toResponse } from "@/lib/http";
import { checkNsqStatus } from "@/lib/cdsco";

export const dynamic = "force-dynamic";

/**
 * Is a batch on the CDSCO not-of-standard-quality list?
 *
 * Public and unauthenticated, like /api/verify — a recall is public-interest
 * information, and the value of it depends on nobody needing an account to see
 * it. Read-only: this endpoint consults imported reference data and writes
 * nothing.
 *
 * Emergency Hold & Recall and Route Integrity do not exist in this codebase, so
 * per the spec this stands alone rather than inventing those features here.
 */
export async function GET(req: Request) {
  try {
    if (!rateLimit(`nsq:${clientIp(req)}`, 60, 60_000)) {
      return fail(429, "RATE_LIMITED", "Too many lookups. Try again in a minute.");
    }

    const url = new URL(req.url);
    const medicineName = url.searchParams.get("medicineName");
    const batchNo = url.searchParams.get("batchNo");

    if (!medicineName || !batchNo) {
      return fail(400, "VALIDATION_ERROR", "medicineName and batchNo are both required", {
        hint: "A batch number alone cannot identify a batch — numbers collide across manufacturers.",
      });
    }

    const rows = await prisma.nsqAlert.findMany({ where: { batchNo } });
    const result = checkNsqStatus(medicineName, batchNo, rows);

    return ok({
      ...result,
      // Stated explicitly so no caller conflates this with RCCP's own receipt.
      signal: "CDSCO_NSQ",
      note: "This is the regulator's quality finding. It is separate from this system's own OK/EXPIRED compliance receipt, which answers a different question.",
    });
  } catch (e) {
    return toResponse(e);
  }
}
