import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { runTransition, toResponse } from "@/lib/route-helpers";
import { parseBody } from "@/lib/http";
import { ReturnState, Role } from "@/lib/types";

const Body = z.object({
  declaredQty: z.number().int().positive(),
  condition: z.string().min(1),
  photoUrl: z.string().min(1).optional().nullable(),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole(Role.RETAILER);
    const body = await parseBody(req, Body);
    return await runTransition({
      req,
      session,
      returnId: params.id,
      ownerField: "retailerId",
      targetState: ReturnState.INITIATED,
      endpoint: "POST /api/returns/:id/initiate",
      body,
      payload: { to: ReturnState.INITIATED, ...body },
    });
  } catch (e) {
    return toResponse(e);
  }
}
