import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { parseBody, toResponse } from "@/lib/http";
import { runTransition } from "@/lib/route-helpers";
import { ReturnState, Role } from "@/lib/types";

export const dynamic = "force-dynamic";

const Body = z.object({
  returnId: z.string().min(1),
  facilityId: z.string().min(1),
  qty: z.number().int().positive(),
  scheduledDate: z.string().datetime(),
});

export async function POST(req: Request) {
  try {
    const session = await requireRole(Role.MANUFACTURER);
    const body = await parseBody(req, Body);
    return await runTransition({
      req,
      session,
      returnId: body.returnId,
      ownerField: "manufacturerId",
      targetState: ReturnState.DISPOSAL_SCHEDULED,
      endpoint: "POST /api/disposals",
      body,
      payload: {
        to: ReturnState.DISPOSAL_SCHEDULED,
        facilityId: body.facilityId,
        qty: body.qty,
        scheduledDate: new Date(body.scheduledDate),
      },
    });
  } catch (e) {
    return toResponse(e);
  }
}
