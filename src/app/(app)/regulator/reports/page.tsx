"use client";

import { useApi } from "@/lib/client";
import { Card, CardHeader, Chip, Empty, Table, Td } from "@/components/ui";
import { Stat } from "@/components/verdict";

interface Report {
  id: string;
  batchId: string | null;
  resolved: boolean;
  batchNo: string;
  product: string | null;
  manufacturer: string | null;
  rawManufacturerRef: string;
  rawBatchNo: string;
  reason: string;
  description: string | null;
  location: string | null;
  createdAt: string;
}

export default function ReportsPage() {
  const { data, loading } = useApi<{
    items: Report[];
    count: number;
    unresolved: number;
    caveat: string;
  }>("/api/citizen-reports");
  const items = data?.items ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Public reports</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-700">
          Submitted from the public verify page with no account. Treated as evidence to look
          into — never as a finding against the medicine or the pharmacy.
        </p>
      </div>

      <Card className="flex flex-wrap gap-10 p-5">
        <Stat label="Reports received" value={data?.count ?? 0} />
        <Stat
          label="About a batch that does not exist"
          value={data?.unresolved ?? 0}
          tone={data?.unresolved ? "red" : "slate"}
          hint="the strongest counterfeit signal"
        />
      </Card>

      <Card>
        <CardHeader title="Inbox" />
        {loading ? (
          <Empty>Loading…</Empty>
        ) : items.length === 0 ? (
          <Empty>No public reports yet.</Empty>
        ) : (
          <Table head={["Batch reported", "Reason", "What they said", "Where", "When"]}>
            {items.map((r) => (
              <tr key={r.id} className={r.resolved ? undefined : "bg-red-50/60"}>
                <Td className="font-medium">
                  {r.rawBatchNo}
                  {r.resolved ? (
                    <span className="block text-xs text-ink-500">
                      {r.product} · {r.manufacturer}
                    </span>
                  ) : (
                    <Chip tone="red" className="mt-1">
                      No such batch on any register
                    </Chip>
                  )}
                </Td>
                <Td className="font-mono text-xs">{r.reason}</Td>
                <Td className="max-w-md text-ink-700">{r.description ?? "—"}</Td>
                <Td className="text-ink-700">{r.location ?? "—"}</Td>
                <Td className="text-xs text-ink-500">{r.createdAt.slice(0, 16).replace("T", " ")}</Td>
              </tr>
            ))}
          </Table>
        )}
        <p className="border-t border-line px-5 py-3 text-xs text-ink-700">
          {data?.caveat ?? "A citizen report is evidence, not a finding."} A report naming a batch
          number that appears on no register is kept deliberately — rejecting it for failing to
          match would discard exactly the counterfeit signal it raises.
        </p>
      </Card>
    </div>
  );
}
