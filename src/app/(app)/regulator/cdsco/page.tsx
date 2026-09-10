"use client";

import { useApi } from "@/lib/client";
import { Card, CardHeader, Chip, Empty, Table, Td } from "@/components/ui";

interface Nsq {
  id: string;
  medicineName: string;
  batchNo: string;
  dateFlagged: string;
  reason: string;
  source: string;
  trackedHere: boolean;
}
interface Entity {
  id: string;
  name: string;
  licenseNo: string;
  type: string;
  state: string;
  status: string;
}
interface Resp {
  nsq: { total: number; matchedInRccp: number; matchedBatches: { batchNo: string; product: string; manufacturer: string }[]; items: Nsq[] };
  entities: { total: number; notActive: number; items: Entity[] };
}

export default function CdscoPage() {
  const { data, loading } = useApi<Resp>("/api/cdsco");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">CDSCO reference data</h1>
        <p className="mt-1 text-sm text-slate-600">
          Imported from published CDSCO exports. This is external ground truth, held separately from
          this system&apos;s own findings — a batch can be clear in our ledger and still be recalled
          on quality, or the reverse.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-5">
          <p className="text-xs uppercase tracking-wide text-slate-500">NSQ alerts imported</p>
          <p className="mt-1 text-4xl font-bold tracking-tight">{data?.nsq.total ?? 0}</p>
        </Card>
        <Card className={`p-5 ${(data?.nsq.matchedInRccp ?? 0) > 0 ? "border-amber-300 bg-amber-50" : ""}`}>
          <p className="text-xs uppercase tracking-wide text-slate-500">Matching stock we track</p>
          <p className="mt-1 text-4xl font-bold tracking-tight text-amber-700">
            {data?.nsq.matchedInRccp ?? 0}
          </p>
          <p className="mt-1 text-xs text-slate-600">Recalled batches present in this supply chain.</p>
        </Card>
        <Card className={`p-5 ${(data?.entities.notActive ?? 0) > 0 ? "border-red-300 bg-red-50" : ""}`}>
          <p className="text-xs uppercase tracking-wide text-slate-500">Licences not ACTIVE</p>
          <p className="mt-1 text-4xl font-bold tracking-tight text-red-700">
            {data?.entities.notActive ?? 0}
          </p>
          <p className="mt-1 text-xs text-slate-600">Suspended or expired in the CDSCO register.</p>
        </Card>
      </div>

      {(data?.nsq.matchedBatches.length ?? 0) > 0 ? (
        <Card className="border-amber-300 bg-amber-50">
          <CardHeader
            title="Recalled batches present in this supply chain"
            subtitle="A hold on these is proposed, not applied. A regulator confirms it — CDSCO imports can be delayed or mis-keyed, so nothing acts automatically."
          />
          <div className="px-5 py-4">
            {data?.nsq.matchedBatches.map((m) => (
              <p key={m.batchNo} className="text-sm text-amber-900">
                <span className="font-mono font-semibold">{m.batchNo}</span> — {m.product} ·{" "}
                {m.manufacturer}
              </p>
            ))}
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="NSQ alerts" subtitle="Not-of-standard-quality findings published by CDSCO." />
        {loading ? (
          <Empty>Loading…</Empty>
        ) : (
          <Table head={["Medicine", "Batch", "Flagged", "Reason", "In our chain"]}>
            {(data?.nsq.items ?? []).map((n) => (
              <tr key={n.id} className={n.trackedHere ? "bg-amber-50" : ""}>
                <Td className="font-medium">{n.medicineName}</Td>
                <Td className="font-mono">{n.batchNo}</Td>
                <Td>{n.dateFlagged.slice(0, 10)}</Td>
                <Td className="max-w-sm whitespace-normal text-xs text-slate-700">{n.reason}</Td>
                <Td>{n.trackedHere ? <Chip tone="amber">YES</Chip> : <span className="text-xs text-slate-400">—</span>}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Licensed entities"
          subtitle="A licence that is not ACTIVE here is a different finding from an unauthorised route in this system. The two are never combined."
        />
        {loading ? (
          <Empty>Loading…</Empty>
        ) : (
          <Table head={["Name", "Licence", "Type", "State", "CDSCO status"]}>
            {(data?.entities.items ?? []).map((e) => (
              <tr key={e.id} className={e.status !== "ACTIVE" ? "bg-red-50" : ""}>
                <Td className="font-medium">{e.name}</Td>
                <Td className="font-mono text-xs">{e.licenseNo}</Td>
                <Td>{e.type}</Td>
                <Td>{e.state}</Td>
                <Td>
                  <Chip tone={e.status === "ACTIVE" ? "green" : e.status === "SUSPENDED" ? "red" : "amber"}>
                    {e.status}
                  </Chip>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
