"use client";

import { useState } from "react";
import { useApi } from "@/lib/client";
import { BillQR } from "@/components/qr";
import { Card, CardHeader, Chip, Empty, Table, Td, TableSkeleton } from "@/components/ui";

interface Line {
  product: string;
  manufacturer: string;
  manufacturerLicenseNo: string;
  batchNo: string;
  qty: number;
  expiryDate: string;
}
interface Bill {
  id: string;
  billNo: string;
  token: string;
  pharmacy: string;
  soldAt: string;
  lineCount: number;
  totalUnits: number;
  lines: Line[];
}

const dmy = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

/**
 * Past customer receipts, each with its QR.
 *
 * The QR used to exist only in the moment after a sale, on the dispense screen.
 * Refreshing lost it, which meant a pharmacy could not re-show a customer the
 * code for a purchase they had already made — and the seeded demo receipts had
 * QRs that were rendered nowhere at all.
 *
 * Nothing is regenerated here. The token was minted at the sale and is stored;
 * this only draws it again.
 */
export default function CustomerReceiptsPage() {
  const { data, loading } = useApi<{ items: Bill[] }>("/api/consumer-bills");
  const [openId, setOpenId] = useState<string | null>(null);

  const items = data?.items ?? [];
  const open = items.find((b) => b.id === openId) ?? null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Customer receipts</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-700">
          Every purchase receipt this pharmacy has issued. The QR resolves to the live record, so a
          batch recalled after the sale turns an already-printed receipt red without it being
          reissued.
        </p>
      </div>

      <Card>
        <CardHeader
          title="Issued receipts"
          subtitle="Select one to show its QR — the customer can scan it off the screen."
        />
        {loading ? (
          <TableSkeleton rows={4} cols={5} />
        ) : items.length === 0 ? (
          <Empty>
            No receipts issued yet. Dispense a medicine to create one.
          </Empty>
        ) : (
          <Table head={["Receipt", "Sold", "Medicines", "Units", ""]}>
            {items.map((b) => (
              <tr
                key={b.id}
                onClick={() => setOpenId(b.id === openId ? null : b.id)}
                className="cursor-pointer"
              >
                <Td className="font-mono font-medium">{b.billNo}</Td>
                <Td className="text-ink-700">{dmy(b.soldAt)}</Td>
                <Td className="whitespace-normal text-ink-700">
                  {b.lines.map((l) => l.product).join(", ")}
                </Td>
                <Td className="tabular-nums">{b.totalUnits}</Td>
                <Td>
                  <Chip tone={b.id === openId ? "green" : "grey"}>
                    {b.id === openId ? "Showing QR" : "Show QR"}
                  </Chip>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {open ? (
        <Card>
          <CardHeader
            title={`Receipt ${open.billNo}`}
            subtitle={`${open.pharmacy} · ${dmy(open.soldAt)}`}
          />
          <div className="flex flex-col gap-6 p-5 sm:flex-row">
            <div className="min-w-0 flex-1">
              <Table head={["Medicine", "Manufacturer", "Batch", "Qty", "Expiry"]}>
                {open.lines.map((l, i) => (
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
                batch — it is not a billing system.
              </p>
            </div>
            <div className="shrink-0 text-center">
              <BillQR token={open.token} size={176} />
              <p className="mx-auto mt-2 max-w-[176px] text-xs text-ink-500">
                Scan to check this medicine at any time. Opens the live record, not a copy printed
                today.
              </p>
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
