"use client";

import { useState } from "react";
import { useApi } from "@/lib/client";
import { Card, CardHeader, Chip, Empty, Select } from "@/components/ui";

interface ReplayEvent {
  at: string;
  kind: string;
  event: string;
  qty: number | null;
  org: string | null;
  detail: string;
  rule: string | null;
  firstInconsistency?: boolean;
}
interface BatchRow {
  id: string;
  batchNo: string;
  product: string;
  issuedQty: number;
}

const KIND_TONE: Record<string, "grey" | "red" | "amber" | "green" | "blue"> = {
  LEDGER: "blue",
  ALERT: "red",
  RECEIPT: "amber",
  HOLD: "red",
  REPORT: "amber",
  AUDIT: "grey",
};

export default function ReplayPage() {
  const { data: batches } = useApi<{ items: BatchRow[] }>("/api/batches");
  const [batchId, setBatchId] = useState("");
  const list = batches?.items ?? [];
  const selected = batchId || [...list].sort((a, b) => b.issuedQty - a.issuedQty)[0]?.id || "";

  const { data, loading } = useApi<{
    batch: { batchNo: string; product: string; manufacturer: string; registryStatus: string };
    events: ReplayEvent[];
    firstInconsistencyAt: string | null;
    limits: string;
  }>(selected ? `/api/regulator/replay/${selected}` : null);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Forensic replay</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            One batch, every recorded event, in the order it happened. Each row is read from a
            stored record — nothing here is reconstructed or inferred.
          </p>
        </div>
        <div className="w-72">
          <Select value={selected} onChange={(e) => setBatchId(e.target.value)}>
            {list.map((b) => (
              <option key={b.id} value={b.id}>
                {b.batchNo} — {b.product}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {loading || !data ? (
        <Empty>Loading…</Empty>
      ) : (
        <Card>
          <CardHeader
            title={`${data.batch.batchNo} — ${data.batch.product}`}
            subtitle={`${data.batch.manufacturer} · currently ${data.batch.registryStatus}`}
            right={
              data.firstInconsistencyAt ? (
                <Chip tone="red">First inconsistency flagged</Chip>
              ) : (
                <Chip tone="green">No inconsistency found</Chip>
              )
            }
          />
          <ol className="divide-y divide-slate-100">
            {data.events.map((e, i) => (
              <li
                key={`${e.at}:${i}`}
                className={`flex gap-4 px-5 py-3 ${e.firstInconsistency ? "bg-red-50" : ""}`}
              >
                <div className="w-36 shrink-0 font-mono text-xs text-slate-500">
                  {e.at.slice(0, 16).replace("T", " ")}
                </div>
                <div className="w-24 shrink-0">
                  <Chip tone={KIND_TONE[e.kind] ?? "grey"}>{e.kind}</Chip>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-900">
                    {e.event}
                    {e.qty !== null ? (
                      <span className="ml-2 tabular-nums text-slate-600">{e.qty.toLocaleString()} units</span>
                    ) : null}
                    {e.org ? <span className="ml-2 text-slate-600">· {e.org}</span> : null}
                  </p>
                  <p className="text-sm text-slate-600">{e.detail}</p>
                  {e.rule ? (
                    <p className="mt-0.5 font-mono text-xs text-red-700">{e.rule}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
          <p className="border-t border-slate-200 px-5 py-3 text-xs text-slate-600">{data.limits}</p>
        </Card>
      )}
    </div>
  );
}
