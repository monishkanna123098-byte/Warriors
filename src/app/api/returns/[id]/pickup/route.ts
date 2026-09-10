import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { runTransition, toResponse } from "@/lib/route-helpers";
import { parseBody } from "@/lib/http";
import { ReturnState, Role } from "@/lib/types";

const Body = z.object({ pickupAt: z.string().datetime() });

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole(Role.DISTRIBUTOR);
    const body = await parseBody(req, Body);
    return await runTransition({
      req,
      session,
      returnId: params.id,
      ownerField: "distributorId",
      targetState: ReturnState.PICKUP_ASSIGNED,
      endpoint: "POST /api/returns/:id/pickup",
      body,
      payload: { to: ReturnState.PICKUP_ASSIGNED, pickupAt: new Date(body.pickupAt) },
    });
  } catch (e) {
    return toResponse(e);
  }
}
