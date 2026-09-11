"use client";

import { useState } from "react";
import { post, useApi, ApiFailure, type ApiError } from "@/lib/client";
import { BillQR } from "@/components/qr";
import { Button, Card, CardHeader, Chip, Empty, ErrorBanner, Input, Table, Td } from "@/components/ui";
import { Verdict } from "@/components/verdict";

interface Line {
  manufacturerRef: string;
  batchNo: string;
  qty: string;
}
interface BillLine {
  product: string;
  manufacturer: string;
  manufacturerLicenseNo: string;
  batchNo: string;
  qty: number;
  expiryDate: string;
}
interface Bill {
  billNo: string;
  token: string;
  pharmacy: string;
  pharmacyLicenseNo: string;
  soldAt: string;
  lines: BillLine[];
}

const BLANK: Line = { manufacturerRef: "", batchNo: "", qty: "1" };
const dmy = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

export default function SellPage() {
  const inventory = useApi<{
    items: {
      batchId: string;
      batchNo: string;
      product: string;
      manufacturerLicenseNo: string;
      qty: number;
      status: string;
      registryStatus: string;
      expiryState: string;
    }[];
  }>("/api/inventory");

  const [lines, setLines] = useState<Line[]>([{ ...BLANK }]);
  const [bill, setBill] = useState<Bill | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, n) => (n === i ? { ...l, ...patch } : l)));

  /**
   * Fill the next empty line from the shelf. Retyping a licence number and a
   * batch number by hand at a counter is how the wrong batch gets dispensed —
   * and in a demo it is dead air.
   */
  const addFromShelf = (manufacturerRef: string, batchNo: string) =>
    setLines((ls) => {
      const blank = ls.findIndex((l) => !l.manufacturerRef.trim() && !l.batchNo.trim());
      const line = { manufacturerRef, batchNo, qty: "1" };
      if (blank === -1) return [...ls, line];
      return ls.map((l, n) => (n === blank ? line : l));
    });

  async function sell() {
    setBusy(true);
    setError(null);
    setBill(null);
    try {
      setBill(
        await post<Bill>("/api/consumer-bills", {
          lines: lines
            .filter((l) => l.manufacturerRef.trim() && l.batchNo.trim())
            .map((l) => ({
              manufacturerRef: l.manufacturerRef.trim(),
              batchNo: l.batchNo.trim(),
              qty: Number(l.qty) || 1,
            })),
        }),
      );
      setLines([{ ...BLANK }]);
      await inventory.reload();
    } catch (e) {
      setError(e instanceof ApiFailure ? e.error : { code: "CONFLICT", message: String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Dispense and issue a receipt</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-700">
          Every line goes through the same checks as the POS terminal. If one line fails, the
          whole sale is refused — a receipt for medicine the system would not sell is worse than
          no receipt at all.
        </p>
      </div>

      {error ? (
        <Verdict
          tone="red"
          headline="SALE REFUSED"
          what={error.code.replace(/_/g, " ")}
          why={error.message}
          action="Do not dispense. Remove this stock from the shelf and route it for return."
          rule={error.code}
        />
      ) : null}

      {bill ? (
        <Card className="overflow-hidden">
          <CardHeader
            title={`Receipt ${bill.billNo}`}
            subtitle={`${bill.pharmacy} · ${bill.pharmacyLicenseNo} · ${dmy(bill.soldAt)}`}
          />
          <div className="flex flex-col gap-6 p-5 sm:flex-row">
            <div className="min-w-0 flex-1">
              <Table head={["Medicine", "Manufacturer", "Batch", "Qty", "Expiry"]}>
                {bill.lines.map((l, i) => (
                  <tr key={i}>
                    <Td className="font-medium">{l.product}</Td>
                    <Td className="text-ink-700">
                      {l.manufacturer}
                      <span className="block font-mono text-xs text-ink-500">
                        {l.manufacturerLicenseNo}
                      </span>
                    </Td>
                    <Td className="font-mono">{l.batchNo}</Td>
                    <Td className="tabular-nums">{l.qty}</Td>
                    <Td>{dmy(l.expiryDate)}</Td>
                  </tr>
                ))}
              </Table>
              <p className="mt-3 text-xs text-ink-500">
                No price appears on this receipt. RCCP records what was dispensed and from which
                batch — it is not a billing system, and a receipt carrying money would invite
                someone to treat it as one.
              </p>
            </div>
            <div className="shrink-0 text-center">
              <BillQR token={bill.token} />
              <p className="mt-2 max-w-[148px] text-xs text-ink-700">
                Scan to check this medicine at any time. The code resolves to the live record,
                not to a copy printed today.
              </p>
            </div>
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="New sale"
          subtitle="One line per medicine. Different manufacturers on one receipt is normal, and a quantity of 1 is a first-class case."
        />
        <div className="space-y-4 p-5">
          {lines.map((l, i) => (
            <div key={i} className="grid gap-3 sm:grid-cols-[1fr_1fr_100px_auto]">
              <Input
                value={l.manufacturerRef}
                onChange={(e) => set(i, { manufacturerRef: e.target.value })}
                placeholder="Manufacturer licence e.g. MFG/TN/001"
              />
              <Input
                value={l.batchNo}
                onChange={(e) => set(i, { batchNo: e.target.value })}
                placeholder="Batch e.g. P-9100"
              />
              <Input
                value={l.qty}
                onChange={(e) => set(i, { qty: e.target.value })}
                inputMode="numeric"
                placeholder="Qty"
              />
              <Button
                variant="ghost"
                onClick={() => setLines((ls) => (ls.length === 1 ? ls : ls.filter((_, n) => n !== i)))}
                disabled={lines.length === 1}
              >
                Remove
              </Button>
            </div>
          ))}

          {/* flex-wrap, not flex: both buttons refuse to wrap their own labels
              (a two-line button reads as broken), so the ROW has to be what
              gives at 320px. Without it the pair is ~438px wide and scrolls the
              whole page sideways. */}
          <div className="flex flex-wrap gap-3">
            <Button variant="ghost" onClick={() => setLines((ls) => [...ls, { ...BLANK }])}>
              Add another medicine
            </Button>
            <Button onClick={sell} disabled={busy}>
              {busy ? "Checking…" : "Dispense and print receipt"}
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="On the shelf"
          subtitle="Tap a row to add it to the sale. Stock that cannot be sold is still listed — the refusal is the point."
        />
        {(inventory.data?.items ?? []).length === 0 ? (
          <Empty>No stock on hand.</Empty>
        ) : (
          <Table head={["Batch", "Medicine", "Manufacturer", "On hand", "", ""]}>
            {(inventory.data?.items ?? []).map((i) => {
              const sellable =
                i.status === "ACTIVE" &&
                i.registryStatus === "CLEAN" &&
                i.expiryState !== "RETURN_DUE";
              return (
                <tr key={i.batchId} className={sellable ? undefined : "bg-sunken"}>
                  <Td className="font-mono">{i.batchNo}</Td>
                  <Td>{i.product}</Td>
                  <Td className="font-mono text-xs text-ink-700">{i.manufacturerLicenseNo}</Td>
                  <Td className="tabular-nums">{i.qty}</Td>
                  <Td>
                    {sellable ? null : (
                      <Chip tone="red">
                        {i.registryStatus !== "CLEAN"
                          ? i.registryStatus
                          : i.status !== "ACTIVE"
                            ? i.status
                            : "EXPIRED"}
                      </Chip>
                    )}
                  </Td>
                  <Td>
                    <Button
                      variant="ghost"
                      onClick={() => addFromShelf(i.manufacturerLicenseNo, i.batchNo)}
                    >
                      Add to sale
                    </Button>
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
    </div>
  );
}
