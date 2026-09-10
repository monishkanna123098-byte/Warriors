"use client";

import { useApi } from "@/lib/client";
import { Card, CardHeader, Chip, Empty, Table, Td, severityTone } from "@/components/ui";
import type { Severity } from "@/lib/types";

interface Alert {
  id: string;
  code: string;
  severity: Severity;
  batchNo: string | null;
  orgName: string | null;
  createdAt: string;
  payload: unknown;
}

/**
 * A manufacturer sees alerts on its own batches. The regulator's view is the
 * cross-organisation one; this is deliberately scoped.
 */
export default function MfgAlertsPage() {
  // /api/alerts scopes to this manufacturer's own batches server-side.
  const { data, loading, error } = useApi<{ items: Alert[] }>("/api/alerts");
  const items = data?.items ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold tracking-tight">Alerts on my batches</h1>
      <Card>
        <CardHeader title="Compliance findings" />
        {error ? (
          <Empty>{error.message}</Empty>
        ) : loading ? (
          <Empty>Loading…</Empty>
        ) : items.length === 0 ? (
          <Empty>No alerts raised against your batches.</Empty>
        ) : (
          <Table head={["Severity", "Code", "Batch", "Raised by", "When"]}>
            {items.map((a) => (
              <tr key={a.id}>
                <Td>
                  <Chip tone={severityTone[a.severity]}>{a.severity}</Chip>
                </Td>
                <Td className="font-mono text-xs">{a.code}</Td>
                <Td className="font-mono">{a.batchNo}</Td>
                <Td>{a.orgName ?? "—"}</Td>
                <Td>{new Date(a.createdAt).toLocaleString()}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
