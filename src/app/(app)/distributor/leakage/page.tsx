"use client";

import { useApi } from "@/lib/client";
import { Card, CardHeader, Chip, Empty, Table, Td } from "@/components/ui";

interface Ret {
  id: string;
  batchNo: string;
  product: string;
  declaredQty: number | null;
  distReceivedQty: number | null;
  leakage: { id: string; leakedQty: number; declaredQty: number; receivedQty: number; status: string }[];
}

export default function LeakagePage() {
  const { data, loading } = useApi<{ items: Ret[] }>("/api/returns");
  const rows = (data?.items ?? []).flatMap((r) =>
    r.leakage.map((l) => ({ ...l, batchNo: r.batchNo, product: r.product })),
  );

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold tracking-tight">Leakage ledger</h1>
      <Card>
        <CardHeader
          title="Records on returns routed through this distributor"
          subtitle="An open record is the correct end state for units that left a pharmacy and did not arrive. Nothing here closes automatically."
        />
        {loading ? (
          <Empty>Loading…</Empty>
        ) : rows.length === 0 ? (
          <Empty>No shortfalls recorded.</Empty>
        ) : (
          <Table head={["Product", "Batch", "Declared", "Received", "Unaccounted", "Status"]}>
            {rows.map((l) => (
              <tr key={l.id}>
                <Td className="font-medium">{l.product}</Td>
                <Td className="font-mono">{l.batchNo}</Td>
                <Td>{l.declaredQty}</Td>
                <Td>{l.receivedQty}</Td>
                <Td className="font-semibold text-red-700">{l.leakedQty}</Td>
                <Td>
                  <Chip tone={l.status === "OPEN" ? "red" : "grey"}>{l.status}</Chip>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
