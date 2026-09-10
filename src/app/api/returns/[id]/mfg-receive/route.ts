import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { runTransition, toResponse } from "@/lib/route-helpers";
import { parseBody } from "@/lib/http";
import { ReturnState, Role } from "@/lib/types";

const Body = z.object({ receivedQty: z.number().int().nonnegative() });

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole(Role.MANUFACTURER);
    const body = await parseBody(req, Body);
    return await runTransition({
      req,
      session,
      returnId: params.id,
      ownerField: "manufacturerId",
      targetState: ReturnState.MANUFACTURER_RECEIVED,
      endpoint: "POST /api/returns/:id/mfg-receive",
      body,
      payload: { to: ReturnState.MANUFACTURER_RECEIVED, receivedQty: body.receivedQty },
    });
  } catch (e) {
    return toResponse(e);
  }
}
