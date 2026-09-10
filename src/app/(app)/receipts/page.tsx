"use client";

// Compliance receipts — the EXPIRED-batch indicator for staff.
//
// Surfaces flagged activity without anyone having to open individual returns.
// Follows the existing Card/Table/Chip patterns in this directory rather than
// introducing a new visual language.

import { useState } from "react";
import { useApi } from "@/lib/client";
import { Card, CardHeader, Chip, Empty, Table, Td } from "@/components/ui";
import { cn } from "@/lib/cn";

interface Bill {
  id: string;
  status: "OK" | "EXPIRED";
  headline: string;
  anomalyCodes: string[];
  anomalyNote: string | null;
  quantity: number;
  generatedAt: string;
  batchNo: string;
  product: string;
  manufacturer: string;
  registryStatus: string;
  source: "RETURN" | "POS";
}

const FILTERS = ["EXPIRED", "ALL", "OK"] as const;

export default function ReceiptsPage() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("EXPIRED");
  const { data, loading } = useApi<{ total: number; expiredCount: number; items: Bill[] }>(
    `/api/bills${filter === "ALL" ? "" : `?status=${filter}`}`,
  );
  const items = data?.items ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Compliance receipts</h1>
        <p className="mt-1 text-sm text-slate-600">
          Every decision this system makes leaves a receipt saying whether the stock was acceptable
          and why. Receipts are permanent — they are never edited, reissued or withdrawn.
        </p>
      </div>

      <Card className={cn("p-5", (data?.expiredCount ?? 0) > 0 && "border-red-300 bg-red-50")}>
        <p className="text-xs uppercase tracking-wide text-slate-500">
          Batches flagged not acceptable
        </p>
        <p
          className={cn(
            "mt-1 text-4xl font-bold tracking-tight",
            (data?.expiredCount ?? 0) > 0 ? "text-red-700" : "text-slate-900",
          )}
        >
          {filter === "EXPIRED" ? items.length : (data?.expiredCount ?? 0)}
        </p>
        <p className="mt-1 text-sm text-slate-600">
          Each one was refused at the point of decision. None can be overridden.
        </p>
      </Card>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-xs font-medium",
              filter === f
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
            )}
          >
            {f === "EXPIRED" ? "Not acceptable" : f === "OK" ? "Clear" : "All"}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader title={`${items.length} receipts`} />
        {loading ? (
          <Empty>Loading…</Empty>
        ) : items.length === 0 ? (
          <Empty>No receipts in this category.</Empty>
        ) : (
          <Table head={["Status", "Product", "Batch", "Qty", "Finding", "Raised by", "When"]}>
            {items.map((b) => (
              <tr key={b.id} className={b.status === "EXPIRED" ? "bg-red-50/50" : ""}>
                <Td>
                  <Chip tone={b.status === "EXPIRED" ? "red" : "green"}>
                    {b.status === "EXPIRED" ? "NOT ACCEPTABLE" : "OK"}
                  </Chip>
                </Td>
                <Td className="font-medium">{b.product}</Td>
                <Td className="font-mono">{b.batchNo}</Td>
                <Td>{b.quantity}</Td>
                <Td className="max-w-md whitespace-normal text-xs text-slate-700">
                  {b.anomalyCodes.length > 0 ? (
                    <span className="mr-1.5 font-mono font-semibold">
                      {b.anomalyCodes.join(", ")}
                    </span>
                  ) : null}
                  {b.anomalyNote ?? "No findings."}
                </Td>
                <Td>
                  <Chip tone={b.source === "POS" ? "blue" : "grey"}>{b.source}</Chip>
                </Td>
                <Td className="text-xs">{new Date(b.generatedAt).toLocaleString()}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
