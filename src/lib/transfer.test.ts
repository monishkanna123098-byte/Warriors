// transfer.ts — the module that lets stock enter the system through anything
// other than the seed script.
//
// This file needs a real database: executeTransfer takes a Tx, and the property
// worth testing is precisely that both ledger rows land in ONE transaction. A
// mocked client would assert that the code calls the functions it calls, which
// is a tautology, not a test.
//
// Every case runs inside a transaction that always rolls back, so the suite can
// build whatever fixtures it likes and still leave the seeded database exactly
// as it found it — the acceptance harness reads the same rows.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { executeTransfer, isAuthorizedRoute, transferDestinations } from "./transfer";
import { AppError } from "./errors";
import type { Tx } from "./db";
import { AlertCode, LedgerEvent, RegistryStatus, Severity } from "./types";

const prisma = new PrismaClient();

/** Sentinel that unwinds the transaction once the assertions have run. */
class Rollback extends Error {}

/**
 * Runs `fn` inside a transaction and then discards it.
 *
 * The return value is captured before the rollback, so assertions can be made
 * outside on values read inside. Nothing survives in the database.
 */
async function inRollback<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  let out: T | undefined;
  let captured: unknown;
  try {
    await prisma.$transaction(async (tx) => {
      try {
        out = await fn(tx as Tx);
      } catch (e) {
        captured = e;
      }
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  if (captured) throw captured;
  return out as T;
}

let n = 0;
const uniq = (p: string) => `${p}-T${Date.now().toString(36)}-${n++}`;

/** A manufacturer, a distributor, a retailer, a batch, and the routes between them. */
async function fixture(
  tx: Tx,
  opts: { issued?: number; registryStatus?: RegistryStatus; route?: boolean } = {},
) {
  const issued = opts.issued ?? 1000;
  const mkOrg = (type: "MANUFACTURER" | "DISTRIBUTOR" | "RETAILER") =>
    tx.organization.create({
      data: {
        name: uniq(type),
        type,
        licenseNo: uniq(`LIC/${type[0]}`),
        stateCode: "TN",
        district: "Testville",
      },
    });

  const mfg = await mkOrg("MANUFACTURER");
  const dist = await mkOrg("DISTRIBUTOR");
  const ret = await mkOrg("RETAILER");

  const product = await tx.product.create({
    data: { name: uniq("Testicillin"), form: "Tablet", manufacturerId: mfg.id },
  });
  const batch = await tx.batch.create({
    data: {
      manufacturerId: mfg.id,
      batchNo: uniq("BT"),
      productId: product.id,
      issuedQty: issued,
      mfgDate: new Date("2026-01-01T00:00:00Z"),
      expiryDate: new Date("2028-01-01T00:00:00Z"),
      registryStatus: opts.registryStatus ?? RegistryStatus.CLEAN,
    },
  });
  // The manufacturer's own production, which is what gives it a balance to send.
  await tx.batchLedger.create({
    data: { batchId: batch.id, orgId: mfg.id, eventType: LedgerEvent.ISSUED, qtyDelta: issued },
  });

  if (opts.route !== false) {
    await tx.authorizedRoute.createMany({
      data: [
        { fromOrgId: mfg.id, toOrgId: dist.id },
        { fromOrgId: dist.id, toOrgId: ret.id },
      ],
    });
  }

  const actor = { userId: uniq("user"), orgId: mfg.id };
  return { mfg, dist, ret, product, batch, actor };
}

const sums = async (tx: Tx, batchId: string, orgId: string) => {
  const rows = await tx.batchLedger.groupBy({
    by: ["eventType"],
    where: { batchId, orgId },
    _sum: { qtyDelta: true },
  });
  return Object.fromEntries(rows.map((r) => [r.eventType, r._sum.qtyDelta ?? 0]));
};

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("executeTransfer — both sides of the handoff", () => {
  it("writes TRANSFERRED against the sender and SUPPLIED against the receiver", async () => {
    const out = await inRollback(async (tx) => {
      const f = await fixture(tx);
      const r = await executeTransfer(tx, f.actor, {
        batchId: f.batch.id,
        toOrgId: f.dist.id,
        qty: 250,
      });
      return {
        result: r,
        sender: await sums(tx, f.batch.id, f.mfg.id),
        receiver: await sums(tx, f.batch.id, f.dist.id),
        rows: await tx.batchLedger.findMany({
          where: { refType: "Transfer", refId: r.transferId },
          orderBy: { eventType: "asc" },
        }),
      };
    });

    expect(out.sender[LedgerEvent.TRANSFERRED]).toBe(250);
    expect(out.receiver[LedgerEvent.SUPPLIED]).toBe(250);
    // Both rows carry the same Transfer id: the pairing is what makes a change
    // of custody checkable, and either row alone is meaningless.
    expect(out.rows).toHaveLength(2);
    expect(new Set(out.rows.map((r) => r.refId))).toEqual(new Set([out.result.transferId]));
    expect(out.rows.map((r) => r.qtyDelta)).toEqual([250, 250]);
  });

  it("moves the same units out of one balance and into the other — nothing appears or vanishes", async () => {
    const out = await inRollback(async (tx) => {
      const f = await fixture(tx, { issued: 1000 });
      await executeTransfer(tx, f.actor, { batchId: f.batch.id, toOrgId: f.dist.id, qty: 400 });
      const s = await sums(tx, f.batch.id, f.mfg.id);
      const r = await sums(tx, f.batch.id, f.dist.id);
      return {
        senderBalance: (s.ISSUED ?? 0) - (s.TRANSFERRED ?? 0),
        receiverBalance: r.SUPPLIED ?? 0,
      };
    });
    expect(out.senderBalance).toBe(600);
    expect(out.receiverBalance).toBe(400);
    expect(out.senderBalance + out.receiverBalance).toBe(1000);
  });

  it("increments the receiver's inventory and decrements the sender's", async () => {
    const out = await inRollback(async (tx) => {
      const f = await fixture(tx);
      await tx.inventory.create({ data: { orgId: f.mfg.id, batchId: f.batch.id, qty: 1000 } });
      await executeTransfer(tx, f.actor, { batchId: f.batch.id, toOrgId: f.dist.id, qty: 300 });
      return {
        sender: await tx.inventory.findUnique({
          where: { orgId_batchId: { orgId: f.mfg.id, batchId: f.batch.id } },
        }),
        receiver: await tx.inventory.findUnique({
          where: { orgId_batchId: { orgId: f.dist.id, batchId: f.batch.id } },
        }),
      };
    });
    expect(out.sender?.qty).toBe(700);
    expect(out.receiver?.qty).toBe(300);
  });

  it("records a Transfer row and an AuditEvent for the movement", async () => {
    const out = await inRollback(async (tx) => {
      const f = await fixture(tx);
      const r = await executeTransfer(tx, f.actor, {
        batchId: f.batch.id,
        toOrgId: f.dist.id,
        qty: 10,
      });
      return {
        transfer: await tx.transfer.findUnique({ where: { id: r.transferId } }),
        audit: await tx.auditEvent.findFirst({
          where: { entityType: "Transfer", entityId: r.transferId },
        }),
      };
    });
    expect(out.transfer?.qty).toBe(10);
    expect(out.transfer?.authorized).toBe(true);
    expect(out.audit?.action).toBe("STOCK_TRANSFERRED");
    expect(out.audit?.hash).toBeTruthy();
  });
});

describe("executeTransfer — I7 location conservation", () => {
  it("allows a transfer the sender's balance covers exactly", async () => {
    const out = await inRollback(async (tx) => {
      const f = await fixture(tx, { issued: 500 });
      const r = await executeTransfer(tx, f.actor, {
        batchId: f.batch.id,
        toOrgId: f.dist.id,
        qty: 500,
      });
      return r.senderBalanceAfter;
    });
    expect(out).toBe(0);
  });

  it("refuses a transfer that would drive the sender negative, and leaves no row behind", async () => {
    const out = await inRollback(async (tx) => {
      const f = await fixture(tx, { issued: 100 });
      let err: unknown;
      try {
        await executeTransfer(tx, f.actor, { batchId: f.batch.id, toOrgId: f.dist.id, qty: 101 });
      } catch (e) {
        err = e;
      }
      return {
        err,
        transfers: await tx.transfer.count({ where: { batchId: f.batch.id } }),
        ledger: await tx.batchLedger.count({
          where: { batchId: f.batch.id, eventType: LedgerEvent.TRANSFERRED },
        }),
      };
    });

    expect(out.err).toBeInstanceOf(AppError);
    const e = out.err as AppError;
    expect(e.status).toBe(409);
    expect(e.code).toBe(AlertCode.LOCATION_QUANTITY_BREACH);
    // The check runs before anything is written, so a refusal is not a partial
    // write that happens to roll back — there was never a row.
    expect(out.transfers).toBe(0);
    expect(out.ledger).toBe(0);
  });

  it("counts an organisation's earlier transfers against its remaining balance", async () => {
    const out = await inRollback(async (tx) => {
      const f = await fixture(tx, { issued: 100 });
      await executeTransfer(tx, f.actor, { batchId: f.batch.id, toOrgId: f.dist.id, qty: 60 });
      let err: unknown;
      try {
        await executeTransfer(tx, f.actor, { batchId: f.batch.id, toOrgId: f.dist.id, qty: 41 });
      } catch (e) {
        err = e;
      }
      return err;
    });
    expect((out as AppError).code).toBe(AlertCode.LOCATION_QUANTITY_BREACH);
  });
});

describe("executeTransfer — I2 existence", () => {
  it("refuses a batch id that resolves to nothing", async () => {
    const out = await inRollback(async (tx) => {
      const f = await fixture(tx);
      let err: unknown;
      try {
        await executeTransfer(tx, f.actor, {
          batchId: "no-such-batch-id",
          toOrgId: f.dist.id,
          qty: 1,
        });
      } catch (e) {
        err = e;
      }
      return err;
    });
    expect(out).toBeInstanceOf(AppError);
    expect((out as AppError).code).toBe(AlertCode.UNKNOWN_BATCH);
    expect((out as AppError).status).toBe(400);
  });

  it("refuses a receiving organisation that does not exist", async () => {
    const out = await inRollback(async (tx) => {
      const f = await fixture(tx);
      let err: unknown;
      try {
        await executeTransfer(tx, f.actor, {
          batchId: f.batch.id,
          toOrgId: "no-such-org",
          qty: 1,
        });
      } catch (e) {
        err = e;
      }
      return err;
    });
    expect((out as AppError).code).toBe("NOT_FOUND");
  });

  it("refuses a batch that was certified destroyed", async () => {
    const out = await inRollback(async (tx) => {
      const f = await fixture(tx, { registryStatus: RegistryStatus.DESTROYED });
      let err: unknown;
      try {
        await executeTransfer(tx, f.actor, { batchId: f.batch.id, toOrgId: f.dist.id, qty: 1 });
      } catch (e) {
        err = e;
      }
      return err;
    });
    expect((out as AppError).code).toBe(AlertCode.RESURRECTED_BATCH);
    expect((out as AppError).status).toBe(409);
  });

  it("refuses a non-positive quantity and a transfer to self", async () => {
    const out = await inRollback(async (tx) => {
      const f = await fixture(tx);
      const grab = async (fn: () => Promise<unknown>) => {
        try {
          await fn();
          return null;
        } catch (e) {
          return e as AppError;
        }
      };
      return {
        zero: await grab(() =>
          executeTransfer(tx, f.actor, { batchId: f.batch.id, toOrgId: f.dist.id, qty: 0 }),
        ),
        self: await grab(() =>
          executeTransfer(tx, f.actor, { batchId: f.batch.id, toOrgId: f.mfg.id, qty: 1 }),
        ),
      };
    });
    expect(out.zero?.code).toBe("VALIDATION_ERROR");
    expect(out.self?.code).toBe("VALIDATION_ERROR");
  });
});

describe("executeTransfer — alerts raised alongside a recorded movement", () => {
  it("records an unauthorised route rather than refusing it, and raises MEDIUM", async () => {
    const out = await inRollback(async (tx) => {
      const f = await fixture(tx, { route: false });
      const r = await executeTransfer(tx, f.actor, {
        batchId: f.batch.id,
        toOrgId: f.dist.id,
        qty: 5,
      });
      return {
        result: r,
        alerts: await tx.alert.findMany({ where: { batchId: f.batch.id } }),
        transfer: await tx.transfer.findUnique({ where: { id: r.transferId } }),
      };
    });

    // Refusing it would only push the movement off the books, which is the
    // opposite of what the ledger is for.
    expect(out.result.authorized).toBe(false);
    expect(out.transfer?.authorized).toBe(false);
    expect(out.alerts).toHaveLength(1);
    expect(out.alerts[0].code).toBe(AlertCode.UNAUTHORIZED_ROUTE);
    expect(out.alerts[0].severity).toBe(Severity.MEDIUM);
    expect(out.result.alerts.map((a) => a.code)).toContain(AlertCode.UNAUTHORIZED_ROUTE);
  });

  it("raises HIGH when recalled stock moves, without blocking it", async () => {
    const out = await inRollback(async (tx) => {
      const f = await fixture(tx, { registryStatus: RegistryStatus.RECALLED });
      const r = await executeTransfer(tx, f.actor, {
        batchId: f.batch.id,
        toOrgId: f.dist.id,
        qty: 5,
      });
      return { result: r, alerts: await tx.alert.findMany({ where: { batchId: f.batch.id } }) };
    });
    // Stock coming back off a shelf under a recall is the correct response to
    // one, so it is flagged for direction rather than refused.
    const recall = out.alerts.find((a) => a.code === AlertCode.RECALLED_SALE);
    expect(recall).toBeDefined();
    expect(recall!.severity).toBe(Severity.HIGH);
  });

  it("distinguishes a hold from a recall", async () => {
    const out = await inRollback(async (tx) => {
      const f = await fixture(tx, { registryStatus: RegistryStatus.HELD });
      await executeTransfer(tx, f.actor, { batchId: f.batch.id, toOrgId: f.dist.id, qty: 5 });
      return tx.alert.findMany({ where: { batchId: f.batch.id } });
    });
    expect(out.map((a) => a.code)).toContain(AlertCode.HELD_SALE);
  });

  it("raises nothing on an ordinary authorised movement", async () => {
    const out = await inRollback(async (tx) => {
      const f = await fixture(tx);
      await executeTransfer(tx, f.actor, { batchId: f.batch.id, toOrgId: f.dist.id, qty: 5 });
      return tx.alert.count({ where: { batchId: f.batch.id } });
    });
    expect(out).toBe(0);
  });
});

describe("route authorisation", () => {
  it("accepts an explicit AuthorizedRoute", async () => {
    const out = await inRollback(async (tx) => {
      const f = await fixture(tx);
      return isAuthorizedRoute(tx, f.mfg.id, f.dist.id);
    });
    expect(out).toBe(true);
  });

  it("accepts a retailer's mapped distributor, so existing data needs no backfill", async () => {
    const out = await inRollback(async (tx) => {
      const f = await fixture(tx, { route: false });
      await tx.organization.update({
        where: { id: f.ret.id },
        data: { mappedDistributorId: f.dist.id },
      });
      return {
        mapped: await isAuthorizedRoute(tx, f.dist.id, f.ret.id),
        reversed: await isAuthorizedRoute(tx, f.ret.id, f.dist.id),
      };
    });
    expect(out.mapped).toBe(true);
    // A route is directional. Stock flowing back up is a return, not a supply.
    expect(out.reversed).toBe(false);
  });

  it("offers off-route destinations too, marked as such", async () => {
    // executeTransfer RECORDS an unauthorised movement rather than refusing it,
    // so a picker that hid those destinations would contradict the service — and
    // it left a retailer with an empty dropdown, since the authorised network
    // runs manufacturer -> distributor -> retailer and nothing routes FROM a
    // retailer.
    const out = await inRollback(async (tx) => {
      const f = await fixture(tx);
      return {
        fromMfg: await transferDestinations(tx, f.mfg.id),
        fromRetailer: await transferDestinations(tx, f.ret.id),
      };
    });

    const dist = out.fromMfg.find((d) => d.type === "DISTRIBUTOR" && d.authorized);
    expect(dist).toBeDefined();
    // The retailer has no authorised route out at all, and must still be offered
    // somewhere to send to.
    expect(out.fromRetailer.length).toBeGreaterThan(0);
    expect(out.fromRetailer.every((d) => d.authorized === false)).toBe(true);
  });

  it("puts authorised routes first so the safe choice is the obvious one", async () => {
    const out = await inRollback(async (tx) => {
      const f = await fixture(tx);
      return (await transferDestinations(tx, f.mfg.id)).map((d) => d.authorized);
    });
    const firstUnauthorised = out.indexOf(false);
    if (firstUnauthorised !== -1) {
      expect(out.slice(firstUnauthorised).every((a) => a === false)).toBe(true);
    }
  });

  it("never offers the sender itself, the regulator, or a waste facility", async () => {
    const out = await inRollback(async (tx) => {
      const f = await fixture(tx);
      await tx.organization.create({
        data: { name: uniq("REG"), type: "REGULATOR", licenseNo: uniq("R"), stateCode: "TN", district: "X" },
      });
      await tx.organization.create({
        data: { name: uniq("FAC"), type: "FACILITY", licenseNo: uniq("F"), stateCode: "TN", district: "X" },
      });
      return { self: f.mfg.id, dests: await transferDestinations(tx, f.mfg.id) };
    });
    // A facility takes stock through a DisposalRequest, not a Transfer, and the
    // regulator holds no stock at all.
    expect(out.dests.some((d) => d.id === out.self)).toBe(false);
    expect(out.dests.some((d) => d.type === "REGULATOR" || d.type === "FACILITY")).toBe(false);
  });
});

describe("transfer.ts module boundaries", () => {
  const src = readFileSync(join(process.cwd(), "src/lib/transfer.ts"), "utf8");

  it("never writes ReturnRequest.state or Batch.registryStatus (CLAUDE.md rule 2)", () => {
    // Match the WRITE, not text that mentions the field. transfer.ts reads
    // batch.registryStatus to decide whether to flag a movement, which is
    // exactly what it should do; a pattern that catches the read is a test of
    // the test's own cleverness rather than of the rule.
    expect(src).not.toMatch(/\btx\s*\.\s*batch\s*\.\s*(update|updateMany|upsert|delete)/);
    expect(src).not.toMatch(/\btx\s*\.\s*returnRequest\s*\.\s*(update|updateMany|create|delete)/);
  });

  it("evaluates no rule of its own — every verdict comes from invariants.ts", () => {
    expect(src).toMatch(/from "\.\/invariants"/);
    // No inline threshold comparisons standing in for an invariant.
    expect(src).not.toMatch(/if\s*\([^)]*\b(balance|inbound|outbound)\b[^)]*[<>]/);
  });

  it("never updates or deletes a ledger row (CLAUDE.md rule 4)", () => {
    expect(src).not.toMatch(/batchLedger\s*\.\s*(update|delete|upsert)/);
  });
});
