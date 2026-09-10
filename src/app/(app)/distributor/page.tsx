"use client";

// SPEC §6.2 — inbound queue, pickup assignment, and the receive form.
//
// The live shortfall line is deliberately worded as a consequence, not a choice:
// recording 70 against 100 does not approve a 30-unit write-off, it opens a
// leakage record that stays open.

import { useState } from "react";
import { ApiFailure, post, useApi } from "@/lib/client";
import { Button, Card, CardHeader, Chip, Empty, ErrorBanner, Field, Input, Modal } from "@/components/ui";

interface Inbound {
  id: string;
  state: string;
  batchNo: string;
  product: string;
  unitWeightG: number;
  manufacturer: string;
  retailer: string;
  retailerLicenseNo: string;
  declaredQty: number | null;
  condition: string | null;
  dueBy: string;
  pickupAt: string | null;
}

export default function DistributorPage() {
  const { data, loading, reload } = useApi<{ items: Inbound[] }>("/api/returns/inbound");
  const [active, setActive] = useState<Inbound | null>(null);
  const [receivedQty, setReceivedQty] = useState("");
  const [scannedBatchNo, setScannedBatchNo] = useState("");
  const [weightG, setWeightG] = useState("");
  const [error, setError] = useState<{ code: string; message: string; detail?: unknown } | null>(null);
  const [busy, setBusy] = useState(false);

  const items = data?.items ?? [];
  const declared = active?.declaredQty ?? 0;
  const receiving = Number(receivedQty || 0);
  const shortfall = declared - receiving;

  async function assignPickup(id: string) {
    await post(`/api/returns/${id}/pickup`, { pickupAt: new Date().toISOString() });
    await reload();
  }

  async function receive(e: React.FormEvent) {
    e.preventDefault();
    if (!active) return;
    setBusy(true);
    setError(null);
    try {
      await post(`/api/returns/${active.id}/receive`, {
        scannedBatchNo,
        receivedQty: receiving,
        weightG: weightG ? Number(weightG) : null,
        photoUrl: `evidence://intake/${active.batchNo}/${Date.now()}`,
      });
      setActive(null);
      setReceivedQty("");
      setWeightG("");
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
        <CardHeader title="Queue" subtitle="Returns initiated by retailers mapped to this distributor." />
        {loading ? (
          <Empty>Loading…</Empty>
        ) : items.length === 0 ? (
          <Empty>Nothing inbound.</Empty>
        ) : (
          <div className="divide-y divide-slate-100">
            {items.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                <div className="min-w-56 flex-1">
                  <p className="text-sm font-semibold">{r.product}</p>
                  <p className="font-mono text-xs text-slate-600">
                    {r.batchNo} · {r.manufacturer}
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    {r.retailer} ({r.retailerLicenseNo}) · declared {r.declaredQty ?? "—"} · {r.condition}
                  </p>
                </div>
                <Chip tone={r.state === "PICKUP_ASSIGNED" ? "blue" : "amber"}>{r.state}</Chip>
                {r.state === "INITIATED" ? (
                  <Button variant="ghost" onClick={() => assignPickup(r.id)}>
                    Assign pickup
                  </Button>
                ) : (
                  <Button
                    onClick={() => {
                      setActive(r);
                      setScannedBatchNo("");
                      setReceivedQty(String(r.declaredQty ?? ""));
                      setError(null);
                    }}
                  >
                    Receive
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal open={!!active} onClose={() => setActive(null)} title={`Receive — ${active?.batchNo ?? ""}`}>
        <form onSubmit={receive} className="space-y-4">
          <Field
            label="Scanned batch number"
            hint="Must match the batch this return was raised for. A mismatch is rejected, not corrected."
          >
            <Input
              value={scannedBatchNo}
              onChange={(e) => setScannedBatchNo(e.target.value)}
              placeholder={active?.batchNo}
              className="font-mono"
              required
              autoFocus
            />
          </Field>
          <Field label="Quantity received">
            <Input
              type="number"
              min={0}
              value={receivedQty}
              onChange={(e) => setReceivedQty(e.target.value)}
              required
            />
          </Field>
          <Field label="Weight (g, optional)" hint={`Expected about ${(receiving * (active?.unitWeightG ?? 0.75)).toFixed(1)} g at ${active?.unitWeightG ?? 0.75} g per unit.`}>
            <Input type="number" step="0.1" min={0} value={weightG} onChange={(e) => setWeightG(e.target.value)} />
          </Field>

          <div
            className={
              shortfall > 0
                ? "rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
                : "rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700"
            }
          >
            <p>
              Declared <strong>{declared}</strong> · Receiving <strong>{receiving}</strong>
              {shortfall > 0 ? (
                <>
                  {" · "}
                  <strong>{shortfall} units will be recorded as unaccounted</strong>
                </>
              ) : null}
            </p>
            {shortfall > 0 ? (
              <p className="mt-1 text-xs">
                This opens a leakage record against {active?.retailer}. It stays open and is visible to
                the regulator. Recording the shortfall is not approving it.
              </p>
            ) : null}
            {receiving > declared ? (
              <p className="mt-1 text-xs font-semibold">
                More than was declared. This handoff will be rejected.
              </p>
            ) : null}
          </div>

          <ErrorBanner error={error} />
          <div className="flex gap-2">
            <Button type="submit" disabled={busy} className="flex-1">
              {busy ? "Recording…" : "Record receipt"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setActive(null)}>
              Cancel
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
