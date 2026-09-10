"use client";

// SPEC §6.1 — returns due, one card per item with an SLA countdown from dueBy.
// The system raises RETURN_DUE; it never fabricates a return, so INITIATED
// requires this form and its evidence.

import { useState } from "react";
import { ApiFailure, post, useApi } from "@/lib/client";
import { Button, Card, ErrorBanner, Field, Input, Modal, Empty } from "@/components/ui";
import { cn } from "@/lib/cn";

interface DueItem {
  id: string;
  batchNo: string;
  product: string;
  manufacturer: string;
  expiryDate: string;
  dueBy: string;
  daysToDue: number;
  overdue: boolean;
  distributor: string;
}

export default function ReturnsDuePage() {
  const { data, loading, reload } = useApi<{ items: DueItem[] }>("/api/returns/due");
  const [active, setActive] = useState<DueItem | null>(null);
  const [declaredQty, setDeclaredQty] = useState("");
  const [condition, setCondition] = useState("Sealed, intact strips");
  const [photoUrl, setPhotoUrl] = useState("");
  const [error, setError] = useState<{ code: string; message: string; detail?: unknown } | null>(null);
  const [busy, setBusy] = useState(false);

  const items = data?.items ?? [];

  async function initiate(e: React.FormEvent) {
    e.preventDefault();
    if (!active) return;
    setBusy(true);
    setError(null);
    try {
      await post(`/api/returns/${active.id}/initiate`, {
        declaredQty: Number(declaredQty),
        condition,
        photoUrl: photoUrl || `evidence://${active.batchNo}/${Date.now()}`,
      });
      setActive(null);
      setDeclaredQty("");
      setPhotoUrl("");
      await reload();
    } catch (err) {
      if (err instanceof ApiFailure) setError(err.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Returns due</h1>
        <p className="mt-1 text-sm text-slate-600">
          Raised automatically once a batch passes expiry. Confirming a return needs a quantity,
          a condition note and photographic evidence — that is a human act, not an automatic one.
        </p>
      </div>

      {loading ? (
        <Card>
          <Empty>Loading…</Empty>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <Empty>Nothing due. Expired stock will appear here automatically.</Empty>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((r) => (
            <Card
              key={r.id}
              className={cn("p-5", r.overdue ? "border-red-300 bg-red-50/40" : "border-amber-300 bg-amber-50/30")}
            >
              <p className="text-sm font-semibold">{r.product}</p>
              <p className="font-mono text-xs text-slate-600">
                {r.batchNo} · {r.manufacturer}
              </p>
              <p className="mt-3 text-xs text-slate-600">Expired {r.expiryDate.slice(0, 10)}</p>
              <p
                className={cn(
                  "mt-1 text-2xl font-bold tracking-tight",
                  r.overdue ? "text-red-700" : "text-amber-700",
                )}
              >
                {r.overdue ? `${Math.abs(r.daysToDue)} days overdue` : `${r.daysToDue} days left`}
              </p>
              <p className="text-xs text-slate-500">SLA deadline {r.dueBy.slice(0, 10)}</p>
              <p className="mt-3 text-xs text-slate-600">Route: {r.distributor}</p>
              <Button
                className="mt-4 w-full"
                onClick={() => {
                  setActive(r);
                  setError(null);
                }}
              >
                Initiate return
              </Button>
            </Card>
          ))}
        </div>
      )}

      <Modal open={!!active} onClose={() => setActive(null)} title={`Initiate return — ${active?.batchNo ?? ""}`}>
        <form onSubmit={initiate} className="space-y-4">
          <Field
            label="Quantity being returned"
            hint="Checked against what this pharmacy was actually supplied. Returning more than you were sent is refused."
          >
            <Input
              type="number"
              min={1}
              value={declaredQty}
              onChange={(e) => setDeclaredQty(e.target.value)}
              required
              autoFocus
            />
          </Field>
          <Field label="Condition">
            <Input value={condition} onChange={(e) => setCondition(e.target.value)} required />
          </Field>
          <Field label="Photo reference" hint="A URI or reference for the intake photograph.">
            <Input
              value={photoUrl}
              onChange={(e) => setPhotoUrl(e.target.value)}
              placeholder="evidence://…"
            />
          </Field>
          <ErrorBanner error={error} />
          <div className="flex gap-2">
            <Button type="submit" disabled={busy} className="flex-1">
              {busy ? "Submitting…" : "Confirm return"}
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
