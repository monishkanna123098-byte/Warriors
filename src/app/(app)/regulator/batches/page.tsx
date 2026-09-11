"use client";

import { useState } from "react";
import { useApi } from "@/lib/client";
import { Card, CardHeader, Chip, Empty, Input, StackedBar, Table, Td, registryTone } from "@/components/ui";

interface Batch {
  id: string;
  batchNo: string;
  product: string;
  manufacturer: string;
  manufacturerLicenseNo: string;
  issuedQty: number;
  expiryDate: string;
  registryStatus: string;
  destroyedAt: string | null;
  health: { issued: number; billed: number; returned: number; destroyed: number; leaked: number };
}

export default function BatchLookupPage() {
  const { data, loading } = useApi<{ items: Batch[] }>("/api/batches");
  const [q, setQ] = useState("");

  const items = (data?.items ?? []).filter((b) =>
    `${b.batchNo} ${b.product} ${b.manufacturer} ${b.manufacturerLicenseNo}`
      .toLowerCase()
      .includes(q.toLowerCase()),
  );

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold tracking-tight">Batch lookup</h1>
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Batch number, product, manufacturer or licence…"
        className="max-w-md"
      />
      <Card>
        <CardHeader
          title={`${items.length} batches`}
          subtitle="Batches are identified by (manufacturer, batch number). The same number under two manufacturers is two different batches."
        />
        {loading ? (
          <Empty>Loading…</Empty>
        ) : items.length === 0 ? (
          <Empty>No match.</Empty>
        ) : (
          <Table head={["Batch", "Product", "Manufacturer", "Issued", "Expiry", "Registry", "Health"]}>
            {items.map((b) => (
              <tr key={b.id}>
                <Td className="font-mono font-semibold">{b.batchNo}</Td>
                <Td>{b.product}</Td>
                <Td>
                  {b.manufacturer}
                  <span className="block font-mono text-xs text-ink-500">{b.manufacturerLicenseNo}</span>
                </Td>
                <Td>{b.issuedQty}</Td>
                <Td>{b.expiryDate.slice(0, 10)}</Td>
                <Td>
                  <Chip tone={registryTone[b.registryStatus]}>{b.registryStatus}</Chip>
                </Td>
                <Td className="w-64 whitespace-normal">
                  <StackedBar
                    total={b.health.issued}
                    segments={[
                      { label: "billed", value: b.health.billed, className: "bg-blue-500" },
                      { label: "returned", value: b.health.returned, className: "bg-amber-500" },
                      { label: "destroyed", value: b.health.destroyed, className: "bg-ink-700" },
                      { label: "unaccounted", value: b.health.leaked, className: "bg-red-500" },
                    ]}
                  />
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
