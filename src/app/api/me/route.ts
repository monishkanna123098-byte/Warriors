import { currentUser } from "@/lib/auth";
import { ok, toResponse } from "@/lib/http";
import { unauthorized } from "@/lib/errors";

export async function GET() {
  try {
    const user = await currentUser();
    if (!user) throw unauthorized();
    return ok({
      user: { id: user.id, email: user.email, role: user.role },
      organization: {
        id: user.organization.id,
        name: user.organization.name,
        type: user.organization.type,
        licenseNo: user.organization.licenseNo,
        district: user.organization.district,
        stateCode: user.organization.stateCode,
        mappedDistributorId: user.organization.mappedDistributorId,
      },
    });
  } catch (e) {
    return toResponse(e);
  }
}
