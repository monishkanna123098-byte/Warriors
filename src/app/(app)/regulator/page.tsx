"use client";

import Link from "next/link";
import { useApi } from "@/lib/client";
import { Card, CardHeader, Empty } from "@/components/ui";
import { cn } from "@/lib/cn";

interface KpiData {
  openCriticalAlerts: number;
  unaccountedUnits: number;
  overdueReturns: number;
  batchesDestroyed: number;
  expiredReceipts: number;
  nsqAlerts: number;
}

function Kpi({ label, value, href, tone }: { label: string; value: number; href: string; tone: string }) {
  return (
    <Link href={href}>
      <Card className={cn("p-5 transition hover:shadow-md", tone)}>
        <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
        <p className="mt-2 text-4xl font-bold tracking-tight">{value}</p>
      </Card>
    </Link>
  );
}

export default function RegulatorPage() {
  const { data, loading } = useApi<KpiData>("/api/regulator/kpi");
  const { data: audit } = useApi<{ valid: boolean; count: number; brokenAtId?: string }>("/api/audit/verify");

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold tracking-tight">Overview</h1>

      {loading || !data ? (
        <Card>
          <Empty>Loading…</Empty>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi
            label="Open critical alerts"
            value={data.openCriticalAlerts}
            href="/regulator/alerts"
            tone={data.openCriticalAlerts > 0 ? "border-red-300 bg-red-50" : ""}
          />
          <Kpi
            label="Unaccounted units"
            value={data.unaccountedUnits}
            href="/regulator/leakage"
            tone={data.unaccountedUnits > 0 ? "border-amber-300 bg-amber-50" : ""}
          />
          <Kpi label="Overdue returns" value={data.overdueReturns} href="/regulator/overdue" tone="" />
          <Kpi label="Batches destroyed" value={data.batchesDestroyed} href="/regulator/batches" tone="" />
          <Kpi
            label="Refused — compliance receipts"
            value={data.expiredReceipts}
            href="/receipts"
            tone={data.expiredReceipts > 0 ? "border-red-300 bg-red-50" : ""}
          />
          <Kpi
            label="CDSCO quality alerts"
            value={data.nsqAlerts}
            href="/regulator/cdsco"
            tone={data.nsqAlerts > 0 ? "border-amber-300 bg-amber-50" : ""}
          />
        </div>
      )}

      <Card>
        <CardHeader title="Audit chain" subtitle="One global hash chain over every recorded action." />
        <div className="px-5 py-5">
          {audit ? (
            <>
              <p className={cn("text-lg font-semibold", audit.valid ? "text-emerald-700" : "text-red-700")}>
                {audit.valid ? `Intact — ${audit.count} events` : `BROKEN at event ${audit.brokenAtId}`}
              </p>
              <p className="mt-2 max-w-2xl text-sm text-slate-600">
                This proves the digital record was not altered after the fact. It does not prove that
                physical destruction occurred — the certificate is an attestation with an enforced
                quantity ceiling, not independent evidence of incineration.
              </p>
            </>
          ) : (
            <p className="text-sm text-slate-500">Checking…</p>
          )}
        </div>
      </Card>
    </div>
  );
}
