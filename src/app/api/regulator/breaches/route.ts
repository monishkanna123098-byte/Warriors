import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { ok, toResponse } from "@/lib/http";
import { locationBreaches } from "@/lib/accountability";
import { Role } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * I7 sweep — locations whose derived balance went negative.
 *
 * Read-only. A breach here is an ACCOUNTING INCONSISTENCY: the honest readings
 * include a missed inbound record, a mis-keyed quantity and a genuine diversion,
 * and nothing in this endpoint can tell them apart. It is a reason to ask, not
 * a finding of fraud.
 */
export async function GET() {
  try {
    await requireRole(Role.REGULATOR);
    const serverNow = new Date();
    const items = await locationBreaches(prisma, serverNow);
    return ok({
      items,
      count: items.length,
      serverNow: serverNow.toISOString(),
      caveat:
        "A negative balance is an accounting inconsistency, not proof of diversion. Confirm the inbound records before acting on it.",
    });
  } catch (e) {
    return toResponse(e);
  }
}
