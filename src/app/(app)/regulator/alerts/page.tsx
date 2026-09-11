"use client";

import { useState } from "react";
import { post, useApi } from "@/lib/client";
import { Button, Card, CardHeader, Chip, Empty, Table, Td, severityTone } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { Severity } from "@/lib/types";

interface Alert {
  id: string;
  code: string;
  severity: Severity;
  batchNo: string | null;
  manufacturer: string | null;
  orgName: string | null;
  district: string | null;
  acknowledgedAt: string | null;
  createdAt: string;
  payload: unknown;
}

const LEVELS = ["ALL", "CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;

export default function AlertsPage() {
  const [level, setLevel] = useState<(typeof LEVELS)[number]>("ALL");
  const { data, loading, reload } = useApi<{ items: Alert[] }>(
    `/api/regulator/alerts${level === "ALL" ? "" : `?severity=${level}`}`,
  );
  const items = data?.items ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold tracking-tight">Alerts</h1>

      <div className="flex flex-wrap gap-2">
        {LEVELS.map((l) => (
          <button
            key={l}
            onClick={() => setLevel(l)}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-xs font-medium",
              level === l
                ? "border-ink-900 bg-ink-900 text-white"
                : "border-line-strong bg-surface text-ink-700 hover:bg-sunken",
            )}
          >
            {l}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader title={`${items.length} alerts`} />
        {loading ? (
          <Empty>Loading…</Empty>
        ) : items.length === 0 ? (
          <Empty>No alerts at this severity.</Empty>
        ) : (
          <Table head={["Severity", "Code", "Batch", "Manufacturer", "Raised by", "When", ""]}>
            {items.map((a) => (
              <tr key={a.id} className={a.acknowledgedAt ? "opacity-50" : ""}>
                <Td>
                  <Chip tone={severityTone[a.severity]}>{a.severity}</Chip>
                </Td>
                <Td className="font-mono text-xs">{a.code}</Td>
                <Td className="font-mono">{a.batchNo ?? "—"}</Td>
                <Td>{a.manufacturer ?? "—"}</Td>
                <Td>
                  {a.orgName ?? "—"}
                  {a.district ? <span className="text-xs text-ink-500"> · {a.district}</span> : null}
                </Td>
                <Td className="text-xs">{new Date(a.createdAt).toLocaleString()}</Td>
                <Td>
                  {a.acknowledgedAt ? (
                    <span className="text-xs text-ink-500">acknowledged</span>
                  ) : (
                    <Button
                      variant="ghost"
                      onClick={async () => {
                        await post(`/api/alerts/${a.id}/acknowledge`);
                        await reload();
                      }}
                    >
                      Acknowledge
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <p className="text-xs text-ink-500">
        Acknowledging records that the alert was reviewed. It does not close any related leakage
        record — missing units are never closed by an approval.
      </p>
    </div>
  );
}
