"use client";

import { useApi } from "@/lib/client";
import { Card, CardHeader, Chip, Empty, Table, Td } from "@/components/ui";

interface Group {
  fromOrg: string;
  toOrg: string;
  district: string;
  records: number;
  openRecords: number;
  totalLeakedQty: number;
  openLeakedQty: number;
}
interface Record_ {
  id: string;
  batchNo: string;
  fromOrg: string;
  toOrg: string;
  declaredQty: number;
  receivedQty: number;
  leakedQty: number;
  status: string;
  createdAt: string;
}

export default function RegLeakagePage() {
  const { data, loading } = useApi<{ totalUnaccounted: number; groups: Group[]; records: Record_[] }>(
    "/api/regulator/leakage",
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Leakage by organisation</h1>
        <p className="mt-1 text-sm text-ink-700">
          A single shortfall is noise. Repeated leakage against the same pair is the signal.
        </p>
      </div>

      <Card className="p-5">
        <p className="text-xs uppercase tracking-wide text-ink-500">Total unaccounted units (open)</p>
        <p className="mt-1 text-4xl font-bold tracking-tight text-red-700">
          {data?.totalUnaccounted ?? 0}
        </p>
      </Card>

      <Card>
        <CardHeader title="By handoff pair" />
        {loading ? (
          <Empty>Loading…</Empty>
        ) : (data?.groups.length ?? 0) === 0 ? (
          <Empty>No leakage recorded.</Empty>
        ) : (
          <Table head={["From", "To", "District", "Records", "Open", "Open units", "Total units"]}>
            {(data?.groups ?? []).map((g) => (
              <tr key={`${g.fromOrg}->${g.toOrg}`} className={g.openRecords > 1 ? "bg-red-50" : ""}>
                <Td className="font-medium">{g.fromOrg}</Td>
                <Td>{g.toOrg}</Td>
                <Td>{g.district}</Td>
                <Td>{g.records}</Td>
                <Td>{g.openRecords}</Td>
                <Td className="font-semibold text-red-700">{g.openLeakedQty}</Td>
                <Td>{g.totalLeakedQty}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader title="Individual records" subtitle="Never auto-closed." />
        {(data?.records.length ?? 0) === 0 ? (
          <Empty>None.</Empty>
        ) : (
          <Table head={["Batch", "From", "To", "Declared", "Received", "Unaccounted", "Status", "When"]}>
            {(data?.records ?? []).map((r) => (
              <tr key={r.id}>
                <Td className="font-mono">{r.batchNo}</Td>
                <Td>{r.fromOrg}</Td>
                <Td>{r.toOrg}</Td>
                <Td>{r.declaredQty}</Td>
                <Td>{r.receivedQty}</Td>
                <Td className="font-semibold text-red-700">{r.leakedQty}</Td>
                <Td>
                  <Chip tone={r.status === "OPEN" ? "red" : "grey"}>{r.status}</Chip>
                </Td>
                <Td className="text-xs">{r.createdAt.slice(0, 10)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
