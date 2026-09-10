import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { toResponse } from "@/lib/http";
import { runTransition } from "@/lib/route-helpers";
import { forbidden, notFound } from "@/lib/errors";
import { ReturnState, Role } from "@/lib/types";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole(Role.FACILITY);
    const dr = await prisma.disposalRequest.findUnique({ where: { id: params.id } });
    if (!dr) throw notFound(`Disposal request ${params.id} not found`);
    if (dr.facilityId !== session.orgId) throw forbidden("This disposal is assigned to another facility");

    return await runTransition({
      req,
      session,
      returnId: dr.returnId,
      // Already authorised above against DisposalRequest.facilityId — the facility
      // is not a party on ReturnRequest, so there is no field here to match.
      ownerField: null,
      targetState: ReturnState.FACILITY_RECEIVED,
      endpoint: "POST /api/disposals/:id/receive",
      body: { disposalRequestId: params.id },
      payload: { to: ReturnState.FACILITY_RECEIVED, disposalRequestId: params.id },
    });
  } catch (e) {
    return toResponse(e);
  }
}
