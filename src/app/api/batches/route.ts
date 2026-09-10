import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { ok, parseBody, toResponse, withIdempotency } from "@/lib/http";
import { appendAudit } from "@/lib/audit";
import { batchHealth } from "@/lib/ledger";
import { badRequest, conflict } from "@/lib/errors";
import { daysLeft, expiryStateFor } from "@/lib/invariants";
import { LedgerEvent, Role } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const s = await requireRole(Role.MANUFACTURER, Role.REGULATOR);
    const now = new Date();

    const batches = await prisma.batch.findMany({
      where: s.role === Role.MANUFACTURER ? { manufacturerId: s.orgId } : {},
      include: { product: true, manufacturer: true },
      orderBy: { expiryDate: "asc" },
    });

    const items = await Promise.all(
      batches.map(async (b) => ({
        id: b.id,
        batchNo: b.batchNo,
        product: b.product.name,
        productId: b.productId,
        manufacturer: b.manufacturer.name,
        manufacturerLicenseNo: b.manufacturer.licenseNo,
        issuedQty: b.issuedQty,
        mfgDate: b.mfgDate.toISOString(),
        expiryDate: b.expiryDate.toISOString(),
        registryStatus: b.registryStatus,
        destroyedAt: b.destroyedAt?.toISOString() ?? null,
        daysLeft: daysLeft(b.expiryDate, now),
        expiryState: expiryStateFor(b.expiryDate, now),
        health: await batchHealth(prisma, b),
      })),
    );

    return ok({ serverTs: now.toISOString(), items });
  } catch (e) {
    return toResponse(e);
  }
}

const Body = z.object({
  batchNo: z.string().min(1),
  productId: z.string().min(1),
  issuedQty: z.number().int().positive(),
  mfgDate: z.string().datetime(),
  expiryDate: z.string().datetime(),
});

export async function POST(req: Request) {
  try {
    const session = await requireRole(Role.MANUFACTURER);
    const body = await parseBody(req, Body);

    const idem = await withIdempotency(req, session.userId, "POST /api/batches", body);
    if (idem.replay) return idem.replay;

    const product = await prisma.product.findUnique({ where: { id: body.productId } });
    if (!product || product.manufacturerId !== session.orgId) {
      throw badRequest("VALIDATION_ERROR", "Product does not belong to this manufacturer", {
        productId: body.productId,
      });
    }
    if (new Date(body.expiryDate) <= new Date(body.mfgDate)) {
      throw badRequest("VALIDATION_ERROR", "Expiry date must be after the manufacture date");
    }

    const batchNo = body.batchNo.trim().toUpperCase();
    const clash = await prisma.batch.findUnique({
      where: { manufacturerId_batchNo: { manufacturerId: session.orgId, batchNo } },
    });
    if (clash) {
      throw conflict("CONFLICT", "This batch number is already registered to your organisation", {
        batchNo,
      });
    }

    const created = await prisma.$transaction(async (tx) => {
      const batch = await tx.batch.create({
        data: {
          manufacturerId: session.orgId,
          batchNo,
          productId: body.productId,
          issuedQty: body.issuedQty,
          mfgDate: new Date(body.mfgDate),
          expiryDate: new Date(body.expiryDate),
        },
      });

      // The ISSUED row is what gives I1 a ceiling. Without it every scan of this
      // batch would breach mass balance immediately.
      await tx.batchLedger.create({
        data: {
          batchId: batch.id,
          orgId: session.orgId,
          eventType: LedgerEvent.ISSUED,
          qtyDelta: body.issuedQty,
          refType: "Batch",
          refId: batch.id,
        },
      });

      await appendAudit(tx, {
        entityType: "Batch",
        entityId: batch.id,
        action: "BATCH_ISSUED",
        actorUserId: session.userId,
        actorOrgId: session.orgId,
        payload: { batchNo, issuedQty: body.issuedQty, productId: body.productId } as never,
      });

      return batch;
    });

    const payload = {
      id: created.id,
      batchNo: created.batchNo,
      issuedQty: created.issuedQty,
      expiryDate: created.expiryDate.toISOString(),
      registryStatus: created.registryStatus,
    };
    await idem.record(201, payload);
    return ok(payload, 201);
  } catch (e) {
    return toResponse(e);
  }
}
