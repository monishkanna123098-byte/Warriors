"use client";

import { useApi } from "@/lib/client";
import { Card, CardHeader, Chip, Empty, Table, Td, severityTone } from "@/components/ui";
import { Stat } from "@/components/verdict";
import type { Severity } from "@/lib/types";

interface Stall {
  returnId: string;
  batchNo: string;
  product: string;
  manufacturer: string;
  qty: number;
  state: string;
  stalled: boolean;
  elapsedDays: number;
  slaDays: number;
  overdueDays: number;
  deadline: string | null;
  expectedNext: string | null;
  owedByRole: string | null;
  owedByOrg: string | null;
  severity: Severity | null;
}

export default function StallsPage() {
  const { data, loading } = useApi<{ items: Stall[]; stalled: number; inFlight: number }>(
    "/api/regulator/stalls",
  );
  const items = data?.items ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Stalled returns</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">
          Stock that entered the pipeline and stopped moving. Nothing was refused here — the
          next event simply never happened, which is why none of I1–I6 fires.
        </p>
      </div>

      <Card className="flex flex-wrap gap-10 p-5">
        <Stat label="Stalled past deadline" value={data?.stalled ?? 0} tone={data?.stalled ? "red" : "green"} />
        <Stat label="In flight" value={data?.inFlight ?? 0} />
      </Card>

      <Card>
        <CardHeader title="Every return in flight" subtitle="Stalled first, longest overdue at the top." />
        {loading ? (
          <Empty>Loading…</Empty>
        ) : items.length === 0 ? (
          <Empty>No returns in flight.</Empty>
        ) : (
          <Table head={["Batch", "Qty", "Stuck at", "Waiting on", "Elapsed", "Deadline", "Expected next", ""]}>
            {items.map((s) => (
              <tr key={s.returnId} className={s.stalled ? "bg-red-50/60" : undefined}>
                <Td className="font-medium">
                  {s.batchNo}
                  <span className="block text-xs text-slate-500">
                    {s.product} · {s.manufacturer}
                  </span>
                </Td>
                <Td className="tabular-nums">{s.qty}</Td>
                <Td className="font-mono text-xs">{s.state}</Td>
                <Td>
                  {s.owedByOrg ?? "—"}
                  <span className="block text-xs text-slate-500">{s.owedByRole}</span>
                </Td>
                <Td className="tabular-nums">{s.elapsedDays}d of {s.slaDays}d</Td>
                <Td className="text-xs text-slate-600">{s.deadline?.slice(0, 10) ?? "—"}</Td>
                <Td className="font-mono text-xs text-slate-600">{s.expectedNext ?? "—"}</Td>
                <Td>
                  {s.stalled && s.severity ? (
                    <Chip tone={severityTone[s.severity]}>{s.overdueDays}d overdue</Chip>
                  ) : (
                    <Chip tone="green">On time</Chip>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
        <p className="border-t border-slate-200 px-5 py-3 text-xs text-slate-500">
          I8 measures elapsed time against the server clock only. A stall says nobody acted; it
          does not say why, and a genuine logistics delay looks identical to a deliberate one.
        </p>
      </Card>
    </div>
  );
}
