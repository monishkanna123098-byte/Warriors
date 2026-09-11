"use client";

import { useApi } from "@/lib/client";
import { Card, CardHeader, Chip, Empty, registryTone } from "@/components/ui";
import { cn } from "@/lib/cn";

interface Ret {
  id: string;
  state: string;
  batchNo: string;
  product: string;
  manufacturer: string;
  registryStatus: string;
  declaredQty: number | null;
  distReceivedQty: number | null;
  mfgReceivedQty: number | null;
  confirmedQty: number | null;
  timeline: { state: string; reached: boolean }[];
  leakage: { id: string; leakedQty: number; status: string }[];
  certificates: { id: string; certNo: string; qty: number }[];
}

const SHORT: Record<string, string> = {
  RETURN_DUE: "Due",
  INITIATED: "Initiated",
  PICKUP_ASSIGNED: "Pickup",
  DISTRIBUTOR_RECEIVED: "Distributor",
  MANUFACTURER_RECEIVED: "Manufacturer",
  DISPOSAL_SCHEDULED: "Scheduled",
  FACILITY_RECEIVED: "Facility",
  CERTIFIED_DESTROYED: "Destroyed",
};

export default function MyReturnsPage() {
  const { data, loading } = useApi<{ items: Ret[] }>("/api/returns");
  const items = data?.items ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold tracking-tight">Returns</h1>
      {loading ? (
        <Card>
          <Empty>Loading…</Empty>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <Empty>No returns yet.</Empty>
        </Card>
      ) : (
        items.map((r) => (
          <Card key={r.id}>
            <CardHeader
              title={`${r.product} · ${r.batchNo}`}
              subtitle={r.manufacturer}
              right={<Chip tone={registryTone[r.registryStatus]}>{r.registryStatus}</Chip>}
            />
            <div className="px-5 py-5">
              <ol className="flex flex-wrap items-center gap-y-3">
                {r.timeline.map((t, i) => (
                  <li key={t.state} className="flex items-center">
                    <div className="flex flex-col items-center">
                      <span
                        className={cn(
                          "flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold",
                          t.reached ? "bg-ink-900 text-white" : "bg-line text-ink-400",
                        )}
                      >
                        {i + 1}
                      </span>
                      <span
                        className={cn(
                          "mt-1.5 w-20 text-center text-[11px]",
                          t.reached ? "font-medium text-ink-900" : "text-ink-400",
                        )}
                      >
                        {SHORT[t.state]}
                      </span>
                    </div>
                    {i < r.timeline.length - 1 ? (
                      <span
                        className={cn(
                          "mx-1 mb-5 h-0.5 w-6",
                          r.timeline[i + 1].reached ? "bg-ink-900" : "bg-line",
                        )}
                      />
                    ) : null}
                  </li>
                ))}
              </ol>

              <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-sunken pt-4 text-sm md:grid-cols-4">
                {[
                  ["Declared", r.declaredQty],
                  ["Distributor received", r.distReceivedQty],
                  ["Manufacturer received", r.mfgReceivedQty],
                  ["Confirmed", r.confirmedQty],
                ].map(([k, v]) => (
                  <div key={String(k)}>
                    <dt className="text-xs uppercase tracking-wide text-ink-500">{k}</dt>
                    <dd className="font-semibold">{v ?? "—"}</dd>
                  </div>
                ))}
              </dl>

              {r.leakage.length > 0 ? (
                <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm">
                  {r.leakage.map((l) => (
                    <p key={l.id} className="text-red-900">
                      <strong>{l.leakedQty} units unaccounted</strong> · status {l.status}. This record
                      stays open; it is not closed by an approval.
                    </p>
                  ))}
                </div>
              ) : null}

              {r.certificates.length > 0 ? (
                <div className="mt-4 rounded-md border border-line bg-sunken px-4 py-3 text-sm">
                  {r.certificates.map((c) => (
                    <p key={c.id} className="font-mono text-xs">
                      {c.certNo} — {c.qty} units
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
