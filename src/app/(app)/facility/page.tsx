"use client";

// SPEC §6.4 — inbound disposals and certificate issue.
//
// The submit button is NOT disabled when the requested quantity exceeds the
// eligible ceiling. The server rejection is the demo: a client-side guard would
// hide the only thing worth showing.

import { useState } from "react";
import { ApiFailure, post, useApi } from "@/lib/client";
import { Button, Card, CardHeader, Chip, Empty, ErrorBanner, Field, Input, StackedBar } from "@/components/ui";

interface Disposal {
  id: string;
  returnId: string;
  returnState: string;
  batchNo: string;
  product: string;
  manufacturer: string;
  qty: number;
  scheduledDate: string;
  facilityReceivedAt: string | null;
  registryStatus: string;
  confirmedQty: number;
  alreadyAllocated: number;
  eligible: number;
  certificates: { id: string; certNo: string; qty: number }[];
}

export default function FacilityPage() {
  const { data, loading, reload } = useApi<{ items: Disposal[] }>("/api/disposals/inbound");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [error, setError] = useState<Record<string, { code: string; message: string; detail?: unknown } | null>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const items = data?.items ?? [];

  async function receive(id: string) {
    setBusy(id);
    try {
      await post(`/api/disposals/${id}/receive`);
      await reload();
    } catch (err) {
      if (err instanceof ApiFailure) setError((s) => ({ ...s, [id]: err.error }));
    } finally {
      setBusy(null);
    }
  }

  async function issue(d: Disposal, e: React.FormEvent) {
    e.preventDefault();
    setBusy(d.id);
    setError((s) => ({ ...s, [d.id]: null }));
    try {
      await post("/api/certificates", { disposalRequestId: d.id, qty: Number(qty[d.id] ?? 0) });
      setQty((s) => ({ ...s, [d.id]: "" }));
      await reload();
    } catch (err) {
      if (err instanceof ApiFailure) setError((s) => ({ ...s, [d.id]: err.error }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Inbound disposals</h1>
        <p className="mt-1 text-sm text-ink-700">
          Common biomedical waste facilities receive by weight and incinerate in bulk; they do not
          record batch numbers. What this screen adds is a quantity ceiling that over-declaration
          cannot pass.
        </p>
      </div>

      {loading ? (
        <Card>
          <Empty>Loading…</Empty>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <Empty>No disposals scheduled to this facility.</Empty>
        </Card>
      ) : (
        items.map((d) => (
          <Card key={d.id}>
            <CardHeader
              title={`${d.product} · ${d.batchNo}`}
              subtitle={`${d.manufacturer} · scheduled ${d.scheduledDate.slice(0, 10)} · ${d.qty} units`}
              right={<Chip tone={d.facilityReceivedAt ? "green" : "amber"}>{d.facilityReceivedAt ? "RECEIVED" : "AWAITING"}</Chip>}
            />
            <div className="space-y-5 px-5 py-5">
              <div>
                <p className="text-xs uppercase tracking-wide text-ink-500">Certificate allocation</p>
                <div className="mt-2">
                  <StackedBar
                    total={d.confirmedQty}
                    segments={[
                      { label: "allocated", value: d.alreadyAllocated, className: "bg-ink-700" },
                      { label: "eligible", value: Math.max(0, d.eligible), className: "bg-emerald-500" },
                    ]}
                  />
                </div>
                <p className="mt-2 text-sm text-ink-700">
                  Confirmed <strong>{d.confirmedQty}</strong> · already allocated{" "}
                  <strong>{d.alreadyAllocated}</strong> · eligible{" "}
                  <strong className="text-emerald-700">{d.eligible}</strong>
                </p>
              </div>

              {!d.facilityReceivedAt ? (
                <Button onClick={() => receive(d.id)} disabled={busy === d.id}>
                  {busy === d.id ? "Recording…" : "Confirm receipt"}
                </Button>
              ) : (
                <form onSubmit={(e) => issue(d, e)} className="space-y-3">
                  <Field
                    label="Certificate quantity"
                    hint="Submission is not blocked client-side. The ceiling is enforced by the server."
                  >
                    <Input
                      type="number"
                      min={1}
                      value={qty[d.id] ?? ""}
                      onChange={(e) => setQty((s) => ({ ...s, [d.id]: e.target.value }))}
                      required
                    />
                  </Field>
                  <ErrorBanner error={error[d.id] ?? null} />
                  <Button type="submit" disabled={busy === d.id}>
                    {busy === d.id ? "Issuing…" : "Issue certificate"}
                  </Button>
                </form>
              )}

              {d.certificates.length > 0 ? (
                <div className="rounded-md border border-line bg-sunken px-4 py-3">
                  <p className="text-xs uppercase tracking-wide text-ink-500">Issued</p>
                  {d.certificates.map((c) => (
                    <p key={c.id} className="mt-1 font-mono text-xs text-ink-900">
                      {c.certNo} — {c.qty} units
                    </p>
                  ))}
                  <p className="mt-2 text-xs text-ink-700">
                    The audit chain proves this record was not altered afterwards. It does not prove
                    physical destruction occurred.
                  </p>
                </div>
              ) : null}
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
