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
          <p className="mt-1 max-w-2xl text-sm text-ink-700">
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
          <ol className="divide-y divide-sunken">
            {data.events.map((e, i) => (
              <li
                key={`${e.at}:${i}`}
                className={`flex flex-col gap-1.5 px-5 py-3 sm:flex-row sm:gap-4 ${e.firstInconsistency ? "bg-red-50" : ""}`}
              >
                {/* Side by side once there is room; stacked below that, because
                    144px + 96px of fixed columns leaves nothing for content on a
                    320px screen. */}
                <div className="flex items-center gap-3 sm:contents">
                  <div className="font-mono text-xs text-ink-500 sm:w-36 sm:shrink-0">
                    {e.at.slice(0, 16).replace("T", " ")}
                  </div>
                  <div className="sm:w-24 sm:shrink-0">
                    <Chip tone={KIND_TONE[e.kind] ?? "grey"}>{e.kind}</Chip>
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="break-words font-medium text-ink-900">
                    {e.event}
                    {e.qty !== null ? (
                      <span className="ml-2 tabular-nums text-ink-700">{e.qty.toLocaleString()} units</span>
                    ) : null}
                    {e.org ? <span className="ml-2 text-ink-700">· {e.org}</span> : null}
                  </p>
                  <p className="text-sm text-ink-700">{e.detail}</p>
                  {e.rule ? (
                    <p className="mt-0.5 font-mono text-xs text-red-700">{e.rule}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
          <p className="border-t border-line px-5 py-3 text-xs text-ink-700">{data.limits}</p>
        </Card>
      )}
    </div>
  );
}
