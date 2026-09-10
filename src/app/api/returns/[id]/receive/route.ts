import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { runTransition, toResponse } from "@/lib/route-helpers";
import { parseBody } from "@/lib/http";
import { ReturnState, Role } from "@/lib/types";

export const dynamic = "force-dynamic";

const Body = z.object({
  scannedBatchNo: z.string().min(1),
  receivedQty: z.number().int().nonnegative(),
  weightG: z.number().nonnegative().optional().nullable(),
  photoUrl: z.string().min(1).optional().nullable(),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole(Role.DISTRIBUTOR);
    const body = await parseBody(req, Body);
    return await runTransition({
      req,
      session,
      returnId: params.id,
      ownerField: "distributorId",
      targetState: ReturnState.DISTRIBUTOR_RECEIVED,
      endpoint: "POST /api/returns/:id/receive",
      body,
      payload: { to: ReturnState.DISTRIBUTOR_RECEIVED, ...body },
    });
  } catch (e) {
    return toResponse(e);
  }
}
