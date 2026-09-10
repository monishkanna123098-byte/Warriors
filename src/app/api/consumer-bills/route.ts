import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { ok, parseBody, toResponse, withIdempotency } from "@/lib/http";
import { badRequest } from "@/lib/errors";
import { appendAudit } from "@/lib/audit";
import { formatBillNo } from "@/lib/consumer";
import { decideScan } from "@/lib/pos";
import { ScanContext, ScanVerdict, Role } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const s = await requireRole(Role.RETAILER, Role.REGULATOR);
    const rows = await prisma.consumerBill.findMany({
      where: s.role === Role.REGULATOR ? {} : { pharmacyId: s.orgId },
      include: { lines: true, pharmacy: true },
      orderBy: { soldAt: "desc" },
      take: 100,
    });

    return ok({
      items: rows.map((b) => ({
        id: b.id,
        billNo: b.billNo,
        token: b.token,
        pharmacy: b.pharmacy.name,
        soldAt: b.soldAt.toISOString(),
        lineCount: b.lines.length,
        totalUnits: b.lines.reduce((n, l) => n + l.qty, 0),
        lines: b.lines.map((l) => ({
          product: l.productName,
          manufacturer: l.manufacturerName,
          manufacturerLicenseNo: l.manufacturerLicenseNo,
          batchNo: l.batchNo,
          qty: l.qty,
          expiryDate: l.expiryDate.toISOString(),
        })),
      })),
    });
  } catch (e) {
    return toResponse(e);
  }
}

const Body = z.object({
  lines: z
    .array(
      z.object({
        manufacturerRef: z.string().min(1),
        batchNo: z.string().min(1),
        // Quantity 1 is a first-class case: a single tablet sold loose is the
        // most common real transaction in an Indian pharmacy, not an edge case.
        qty: z.number().int().positive(),
      }),
    )
    .min(1)
    .max(20),
});

/**
 * Records a sale and issues the consumer's purchase receipt.
 *
 * Every line is evaluated by the REAL decision function (§5.6) — the same one
 * the POS terminal uses. Nothing here is display logic: if a line is blocked,
 * the sale does not happen and no receipt is issued. A receipt for medicine the
 * system would have refused to sell would be worse than no receipt at all.
 *
 * The whole bill is one transaction. A four-line sale where line three is
 * expired must not leave lines one and two billed against the ledger.
 */
export async function POST(req: Request) {
  try {
    const session = await requireRole(Role.RETAILER);
    const body = await parseBody(req, Body);

    const idem = await withIdempotency(req, session.userId, "POST /api/consumer-bills", body);
    if (idem.replay) return idem.replay;

    const serverTs = new Date();

    const result = await prisma.$transaction(async (tx) => {
      const decisions = [];
      for (const line of body.lines) {
        const d = await decideScan(
          tx,
          session.orgId,
          {
            manufacturerRef: line.manufacturerRef,
            batchNo: line.batchNo,
            qty: line.qty,
            context: ScanContext.SALE,
          },
          serverTs,
        );

        await tx.posScan.create({
          data: {
            orgId: session.orgId,
            rawManufacturerRef: line.manufacturerRef,
            rawBatchNo: line.batchNo,
            batchId: d.batch?.id ?? null,
            qty: line.qty,
            context: ScanContext.SALE,
            verdict: d.verdict,
            alertCode: d.alertCode,
          },
        });

        if (d.verdict === ScanVerdict.BLOCK || !d.batch) {
          // Throwing rolls back every BILLED row written for earlier lines.
          throw badRequest(d.alertCode ?? "VALIDATION_ERROR", d.message, {
            line: { manufacturerRef: line.manufacturerRef, batchNo: line.batchNo, qty: line.qty },
            ...d.detail,
          });
        }
        decisions.push({ line, decision: d });
      }

      const since = new Date(Date.UTC(serverTs.getUTCFullYear(), serverTs.getUTCMonth(), serverTs.getUTCDate()));
      const todayCount = await tx.consumerBill.count({ where: { soldAt: { gte: since } } });

      const bill = await tx.consumerBill.create({
        data: {
          billNo: formatBillNo(serverTs, todayCount + 1),
          // 32 random bytes. Not derived from the row id: a guessable public URL
          // would let anyone enumerate every purchase in the system.
          token: randomBytes(24).toString("base64url"),
          pharmacyId: session.orgId,
          soldAt: serverTs,
          lines: {
            create: decisions.map(({ line, decision }) => ({
              batchId: decision.batch!.id,
              productName: decision.batch!.product,
              manufacturerName: decision.batch!.manufacturer,
              manufacturerLicenseNo: decision.batch!.manufacturerLicenseNo,
              batchNo: decision.batch!.batchNo,
              expiryDate: new Date(decision.batch!.expiryDate),
              qty: line.qty,
            })),
          },
        },
        include: { lines: true, pharmacy: true },
      });

      await appendAudit(tx, {
        entityType: "ConsumerBill",
        entityId: bill.id,
        action: "CONSUMER_BILL_ISSUED",
        actorUserId: session.userId,
        actorOrgId: session.orgId,
        payload: {
          billNo: bill.billNo,
          lines: bill.lines.map((l) => ({ batchNo: l.batchNo, qty: l.qty })),
          totalUnits: bill.lines.reduce((n, l) => n + l.qty, 0),
        },
      });

      return {
        id: bill.id,
        billNo: bill.billNo,
        token: bill.token,
        pharmacy: bill.pharmacy.name,
        pharmacyLicenseNo: bill.pharmacy.licenseNo,
        soldAt: bill.soldAt.toISOString(),
        verifyPath: `/verify/bill/${bill.token}`,
        lines: bill.lines.map((l) => ({
          product: l.productName,
          manufacturer: l.manufacturerName,
          manufacturerLicenseNo: l.manufacturerLicenseNo,
          batchNo: l.batchNo,
          qty: l.qty,
          expiryDate: l.expiryDate.toISOString(),
        })),
      };
    });

    await idem.record(200, result);
    return ok(result);
  } catch (e) {
    return toResponse(e);
  }
}
