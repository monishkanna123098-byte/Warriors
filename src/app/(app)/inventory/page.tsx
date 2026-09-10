"use client";

import { useApi } from "@/lib/client";
import { Card, CardHeader, Chip, Empty, Table, Td, expiryTone, registryTone } from "@/components/ui";

interface Item {
  id: string;
  batchNo: string;
  product: string;
  manufacturer: string;
  qty: number;
  status: string;
  expiryDate: string;
  daysLeft: number;
  expiryState: string;
  registryStatus: string;
}

export default function InventoryPage() {
  const { data, loading } = useApi<{ items: Item[] }>("/api/inventory");
  const items = data?.items ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold tracking-tight">Inventory</h1>
      <Card>
        <CardHeader title="On-hand stock" subtitle="Expiry state is computed from the server clock at read time." />
        {loading ? (
          <Empty>Loading…</Empty>
        ) : items.length === 0 ? (
          <Empty>No stock on hand.</Empty>
        ) : (
          <Table head={["Product", "Batch", "Manufacturer", "Qty", "Expiry", "Days left", "State", "Registry", "Stock"]}>
            {items.map((i) => (
              <tr key={i.id}>
                <Td className="font-medium">{i.product}</Td>
                <Td className="font-mono">{i.batchNo}</Td>
                <Td>{i.manufacturer}</Td>
                <Td>{i.qty}</Td>
                <Td>{i.expiryDate.slice(0, 10)}</Td>
                <Td className={i.daysLeft <= 0 ? "font-semibold text-red-700" : ""}>{i.daysLeft}</Td>
                <Td>
                  <Chip tone={expiryTone[i.expiryState]}>{i.expiryState}</Chip>
                </Td>
                <Td>
                  <Chip tone={registryTone[i.registryStatus]}>{i.registryStatus}</Chip>
                </Td>
                <Td>
                  <Chip tone={i.status === "ACTIVE" ? "grey" : "amber"}>{i.status}</Chip>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
