// Public, unauthenticated, rate-limited (SPEC §5 / §6.6).
//
// This endpoint is one of the three enforcement paths that do NOT depend on the
// offender's cooperation (SPEC §11.4), so it stays open — no session, no org.

import { prisma } from "@/lib/db";
import { clientIp, fail, ok, rateLimit, toResponse } from "@/lib/http";
import { licenseCandidates } from "@/lib/license";
import { RegistryStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: { licenseNo: string; batchNo: string } },
) {
  try {
    if (!rateLimit(`verify:${clientIp(req)}`, 60, 60_000)) {
      return fail(429, "RATE_LIMITED", "Too many lookups. Try again in a minute.");
    }

    const licenseNo = decodeURIComponent(params.licenseNo);
    const batchNo = decodeURIComponent(params.batchNo).trim().toUpperCase();
    const serverNow = new Date();

    const candidates = licenseCandidates(licenseNo);
    const orgs = await prisma.organization.findMany({
      where: { type: "MANUFACTURER", licenseNo: { in: candidates } },
    });

    // An ambiguous slug is unresolved, not a guess (see src/lib/license.ts).
    const manufacturer = orgs.length === 1 ? orgs[0] : null;

    const batch = manufacturer
      ? await prisma.batch.findUnique({
          where: { manufacturerId_batchNo: { manufacturerId: manufacturer.id, batchNo } },
          include: { manufacturer: true, product: true },
        })
      : null;

    if (!batch) {
      return ok({
        status: "NOT_FOUND",
        tone: "red",
        headline: "No record of this batch",
        message: "No record of this batch. Do not consume.",
        licenseNo,
        batchNo,
      });
    }

    const base = {
      licenseNo: batch.manufacturer.licenseNo,
      manufacturer: batch.manufacturer.name,
      batchNo: batch.batchNo,
      product: batch.product.name,
      form: batch.product.form,
      expiryDate: batch.expiryDate.toISOString(),
      checkedAt: serverNow.toISOString(),
    };

    if (batch.registryStatus === RegistryStatus.DESTROYED) {
      const on = batch.destroyedAt?.toISOString().slice(0, 10) ?? "an earlier date";
      return ok({
        ...base,
        status: RegistryStatus.DESTROYED,
        tone: "red",
        headline: "Destroyed batch",
        message: `This batch was destroyed on ${on}. Report to ${batch.manufacturer.stateCode} state drug controller.`,
        destroyedAt: batch.destroyedAt?.toISOString() ?? null,
      });
    }

    if (batch.registryStatus === RegistryStatus.IN_RETURN_PIPELINE) {
      return ok({
        ...base,
        status: RegistryStatus.IN_RETURN_PIPELINE,
        tone: "amber",
        headline: "Withdrawn from sale",
        message: "This batch is expired and withdrawn from sale.",
      });
    }

    if (serverNow > batch.expiryDate) {
      return ok({
        ...base,
        status: "EXPIRED",
        tone: "amber",
        headline: "Expired",
        message: `This batch expired on ${batch.expiryDate.toISOString().slice(0, 10)}.`,
      });
    }

    return ok({ ...base, status: RegistryStatus.CLEAN, tone: "green", headline: "Valid", message: "Valid." });
  } catch (e) {
    return toResponse(e);
  }
}
