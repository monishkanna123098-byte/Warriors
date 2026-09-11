"use client";

import { useApi } from "@/lib/client";
import { Card, CardHeader, Empty, Table, Td } from "@/components/ui";
import { Stat } from "@/components/verdict";

interface Breach {
  batchId: string;
  batchNo: string;
  manufacturer: string;
  product: string;
  orgName: string;
  licenseNo: string;
  district: string;
  balance: { balance: number; inbound: number; outbound: number; byEvent: Record<string, number> };
  breach: { shortfall: number; severity: string } | null;
}

export default function BreachesPage() {
  const { data, loading } = useApi<{ items: Breach[]; count: number; caveat: string }>(
    "/api/regulator/breaches",
  );
  const items = data?.items ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Books that do not balance</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-700">
          I7. A location that has sold or shipped more units of a batch than ever reached it.
        </p>
      </div>

      <Card className="flex flex-wrap gap-10 p-5">
        <Stat label="Locations affected" value={data?.count ?? 0} tone={data?.count ? "red" : "green"} />
      </Card>

      <Card>
        <CardHeader title="Negative balances" />
        {loading ? (
          <Empty>Loading…</Empty>
        ) : items.length === 0 ? (
          <Empty>Every location&rsquo;s books balance.</Empty>
        ) : (
          <Table head={["Location", "Batch", "In", "Out", "Balance", "Made up of"]}>
            {items.map((b) => (
              <tr key={`${b.batchId}:${b.licenseNo}`} className="bg-red-50/60">
                <Td className="font-medium">
                  {b.orgName}
                  <span className="block font-mono text-xs text-ink-500">{b.licenseNo}</span>
                </Td>
                <Td>
                  {b.batchNo}
                  <span className="block text-xs text-ink-500">{b.product}</span>
                </Td>
                <Td className="tabular-nums">{b.balance.inbound.toLocaleString()}</Td>
                <Td className="tabular-nums">{b.balance.outbound.toLocaleString()}</Td>
                <Td className="font-bold tabular-nums text-red-700">{b.balance.balance}</Td>
                <Td className="font-mono text-xs text-ink-700">
                  {Object.entries(b.balance.byEvent)
                    .map(([k, v]) => `${k} ${v}`)
                    .join(" · ")}
                </Td>
              </tr>
            ))}
          </Table>
        )}
        <p className="border-t border-line px-5 py-3 text-xs text-ink-700">
          {data?.caveat ??
            "A negative balance is an accounting inconsistency, not proof of diversion."}{" "}
          The most common cause is an inbound record that was never captured — check that before
          anything else.
        </p>
      </Card>
    </div>
  );
}
