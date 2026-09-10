import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { ok, toResponse } from "@/lib/http";
import { verifyChain } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireSession();
    const result = await verifyChain(prisma);
    return ok({
      ...result,
      caveat:
        "This proves the digital record was not altered after the fact. It does not prove that physical destruction occurred.",
    });
  } catch (e) {
    return toResponse(e);
  }
}
