import { prisma } from "@/lib/db";
import { ok, toResponse } from "@/lib/http";
import { notFound } from "@/lib/errors";
import { consumerVerdict, fmtDate, resolveAsOf } from "@/lib/consumer";
import { RegistryStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * PUBLIC. No authentication, by design (Phase 14): a consumer checking whether
 * their own medicine is safe must never be asked to create an account first.
 *
 * The response carries only the consumer-safe fields listed in
 * src/lib/consumer.ts — no patient identity, no regulator notes, no internal
 * signals, no other organisation's data. The token is a bridge to the live
 * record, not a copy of the database, so the status below is computed now rather
 * than read from anything stored at the time of sale.
 */
export async function GET(req: Request, ctx: { params: { token: string } }) {
  try {
    const bill = await prisma.consumerBill.findUnique({
      where: { token: ctx.params.token },
      include: {
        pharmacy: true,
        lines: { include: { batch: true } },
      },
    });
    if (!bill) throw notFound("No purchase record matches this code.");

    const serverNow = new Date();
    const url = new URL(req.url);
    const { asOf, simulated, rejected } = resolveAsOf(url.searchParams.get("asOf"), serverNow);

    const lines = bill.lines.map((l) => {
      const verdict = consumerVerdict({
        batch: l.batch
          ? {
              registryStatus: l.batch.registryStatus as RegistryStatus,
              expiryDate: l.batch.expiryDate,
              destroyedAt: l.batch.destroyedAt,
            }
          : null,
        serverNow: asOf,
      });
      return {
        // The pack as it was handed over — the snapshot taken at sale.
        product: l.productName,
        manufacturer: l.manufacturerName,
        manufacturerLicenseNo: l.manufacturerLicenseNo,
        batchNo: l.batchNo,
        qty: l.qty,
        expiryDate: l.expiryDate.toISOString(),
        expiryDisplay: fmtDate(l.expiryDate),
        // The verdict as it stands right now.
        status: verdict.status,
        headline: verdict.headline,
        explanation: verdict.explanation,
        action: verdict.action,
        safe: verdict.safe,
      };
    });

    return ok({
      billNo: bill.billNo,
      pharmacy: bill.pharmacy.name,
      pharmacyLicenseNo: bill.pharmacy.licenseNo,
      purchaseDate: bill.soldAt.toISOString(),
      purchaseDisplay: fmtDate(bill.soldAt),
      lines,
      allSafe: lines.every((l) => l.safe),
      unsafeCount: lines.filter((l) => !l.safe).length,
      serverNow: serverNow.toISOString(),
      // The demo date control, reported honestly so nobody mistakes a simulated
      // verdict for a live one. Forward-only: it can make a verdict stricter,
      // never laxer, so this URL cannot be crafted to show expired stock as safe.
      evaluatedAt: asOf.toISOString(),
      simulated,
      simulationRejected: rejected,
    });
  } catch (e) {
    return toResponse(e);
  }
}
