"use client";

import { useState } from "react";
import { ApiFailure, post, useApi } from "@/lib/client";
import { Button, Card, CardHeader, Chip, Empty, ErrorBanner, Field, Input, Modal, Select } from "@/components/ui";

interface Up {
  id: string;
  state: string;
  batchNo: string;
  product: string;
  retailer: string;
  distributor: string;
  declaredQty: number | null;
  distReceivedQty: number | null;
  mfgReceivedQty: number | null;
  confirmedQty: number | null;
  disposals: { id: string; qty: number; scheduledDate: string; facilityReceivedAt: string | null; certifiedQty: number }[];
}

interface Org {
  id: string;
  name: string;
  licenseNo: string;
}

export default function UpstreamPage() {
  const { data, loading, reload } = useApi<{ items: Up[] }>("/api/returns/upstream");
  const { data: facs } = useApi<{ items: Org[] }>("/api/orgs?type=FACILITY");
  const [active, setActive] = useState<Up | null>(null);
  const [mode, setMode] = useState<"receive" | "dispose">("receive");
  const [qty, setQty] = useState("");
  const [facilityId, setFacilityId] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [error, setError] = useState<{ code: string; message: string; detail?: unknown } | null>(null);
  const [busy, setBusy] = useState(false);

  const items = data?.items ?? [];
  const facilities = facs?.items ?? [];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!active) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === "receive") {
        await post(`/api/returns/${active.id}/mfg-receive`, { receivedQty: Number(qty) });
      } else {
        await post("/api/disposals", {
          returnId: active.id,
          facilityId: facilityId || facilities[0]?.id,
          qty: Number(qty),
          scheduledDate: new Date(scheduledDate || Date.now() + 86400000).toISOString(),
        });
      }
      setActive(null);
      await reload();
    } catch (err) {
      if (err instanceof ApiFailure) setError(err.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold tracking-tight">Inbound returns</h1>
      <Card>
        <CardHeader
          title="Returns on my batches"
          subtitle="The confirmed quantity is the running minimum along the chain. It is the ceiling every destruction certificate is measured against."
        />
        {loading ? (
          <Empty>Loading…</Empty>
        ) : items.length === 0 ? (
          <Empty>Nothing upstream.</Empty>
        ) : (
          <div className="divide-y divide-slate-100">
            {items.map((r) => (
              <div key={r.id} className="px-5 py-4">
                <div className="flex flex-wrap items-center gap-4">
                  <div className="min-w-56 flex-1">
                    <p className="text-sm font-semibold">
                      {r.product} · <span className="font-mono">{r.batchNo}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-slate-600">
                      {r.retailer} → {r.distributor}
                    </p>
                    <p className="mt-1 text-xs text-slate-600">
                      declared {r.declaredQty ?? "—"} · distributor {r.distReceivedQty ?? "—"} ·
                      manufacturer {r.mfgReceivedQty ?? "—"} ·{" "}
                      <strong>confirmed {r.confirmedQty ?? "—"}</strong>
                    </p>
                  </div>
                  <Chip tone="blue">{r.state}</Chip>
                  {r.state === "DISTRIBUTOR_RECEIVED" ? (
                    <Button
                      onClick={() => {
                        setActive(r);
                        setMode("receive");
                        setQty(String(r.distReceivedQty ?? ""));
                        setError(null);
                      }}
                    >
                      Receive
                    </Button>
                  ) : r.state === "MANUFACTURER_RECEIVED" ? (
                    <Button
                      onClick={() => {
                        setActive(r);
                        setMode("dispose");
                        setQty(String(r.confirmedQty ?? ""));
                        setError(null);
                      }}
                    >
                      Schedule disposal
                    </Button>
                  ) : null}
                </div>
                {r.disposals.length > 0 ? (
                  <div className="mt-3 rounded-md bg-slate-50 px-4 py-2.5 text-xs text-slate-700">
                    {r.disposals.map((d) => (
                      <p key={d.id}>
                        Disposal {d.qty} units · scheduled {d.scheduledDate.slice(0, 10)} ·{" "}
                        {d.facilityReceivedAt ? `received ${d.facilityReceivedAt.slice(0, 10)}` : "awaiting facility"}{" "}
                        · certified {d.certifiedQty}
                      </p>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal
        open={!!active}
        onClose={() => setActive(null)}
        title={mode === "receive" ? `Receive — ${active?.batchNo ?? ""}` : `Schedule disposal — ${active?.batchNo ?? ""}`}
      >
        <form onSubmit={submit} className="space-y-4">
          <Field
            label="Quantity"
            hint={
              mode === "receive"
                ? `Distributor sent ${active?.distReceivedQty ?? 0}. Receiving fewer opens a leakage record against the distributor.`
                : `Capped at the confirmed quantity, ${active?.confirmedQty ?? 0}.`
            }
          >
            <Input type="number" min={0} value={qty} onChange={(e) => setQty(e.target.value)} required autoFocus />
          </Field>
          {mode === "dispose" ? (
            <>
              <Field label="Facility">
                <Select value={facilityId} onChange={(e) => setFacilityId(e.target.value)}>
                  {facilities.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name} — {f.licenseNo}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Scheduled date">
                <Input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} />
              </Field>
            </>
          ) : null}
          <ErrorBanner error={error} />
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Submitting…" : mode === "receive" ? "Record receipt" : "Schedule"}
          </Button>
        </form>
      </Modal>
    </div>
  );
}
