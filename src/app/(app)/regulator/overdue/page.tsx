"use client";

import { useApi } from "@/lib/client";
import { Card, CardHeader, Empty, Table, Td } from "@/components/ui";

interface Item {
  id: string;
  batchNo: string;
  product: string;
  retailer: string;
  retailerLicenseNo: string;
  district: string;
  dueBy: string;
  daysOverdue: number;
}
interface District {
  district: string;
  count: number;
  retailers: string[];
}

export default function OverduePage() {
  const { data, loading } = useApi<{ total: number; byDistrict: District[]; items: Item[] }>(
    "/api/regulator/overdue-returns",
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Overdue returns</h1>
        <p className="mt-1 text-sm text-slate-600">
          Past the SLA deadline and still not initiated. This list does not depend on the retailer
          cooperating — it is what a retailer who simply does nothing looks like.
        </p>
      </div>

      <Card>
        <CardHeader title={`By district — ${data?.total ?? 0} overdue`} />
        {loading ? (
          <Empty>Loading…</Empty>
        ) : (data?.byDistrict.length ?? 0) === 0 ? (
          <Empty>Nothing overdue.</Empty>
        ) : (
          <Table head={["District", "Count", "Retailers"]}>
            {(data?.byDistrict ?? []).map((d) => (
              <tr key={d.district}>
                <Td className="font-medium">{d.district}</Td>
                <Td className="font-semibold">{d.count}</Td>
                <Td className="whitespace-normal text-xs text-slate-600">{d.retailers.join(", ")}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {(data?.items.length ?? 0) > 0 ? (
        <Card>
          <CardHeader title="Individual returns" />
          <Table head={["Product", "Batch", "Retailer", "Licence", "District", "Due by", "Days overdue"]}>
            {(data?.items ?? []).map((i) => (
              <tr key={i.id}>
                <Td className="font-medium">{i.product}</Td>
                <Td className="font-mono">{i.batchNo}</Td>
                <Td>{i.retailer}</Td>
                <Td className="font-mono text-xs">{i.retailerLicenseNo}</Td>
                <Td>{i.district}</Td>
                <Td>{i.dueBy.slice(0, 10)}</Td>
                <Td className="font-semibold text-red-700">{i.daysOverdue}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      ) : null}
    </div>
  );
}
