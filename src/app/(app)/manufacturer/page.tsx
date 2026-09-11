"use client";

// SPEC §6.3 — the issued batch registry. issuedQty is what gives I1 a ceiling;
// without this screen there is no mass balance to breach.

import { useState } from "react";
import { ApiFailure, post, useApi } from "@/lib/client";
import {
  Button,
  Card,
  CardHeader,
  Chip,
  Empty,
  ErrorBanner,
  Field,
  Input,
  Modal,
  Select,
  StackedBar,
  expiryTone,
  registryTone,
} from "@/components/ui";
import { VerifyQR } from "@/components/qr";

interface Batch {
  id: string;
  batchNo: string;
  product: string;
  productId: string;
  manufacturerLicenseNo: string;
  issuedQty: number;
  mfgDate: string;
  expiryDate: string;
  registryStatus: string;
  destroyedAt: string | null;
  daysLeft: number;
  expiryState: string;
  health: { issued: number; billed: number; returned: number; destroyed: number; leaked: number; unaccounted: number };
}

export default function ManufacturerPage() {
  const { data, loading, reload } = useApi<{ items: Batch[] }>("/api/batches");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ batchNo: "", productId: "", issuedQty: "", mfgDate: "", expiryDate: "" });
  const [error, setError] = useState<{ code: string; message: string; detail?: unknown } | null>(null);
  const [busy, setBusy] = useState(false);

  const items = data?.items ?? [];
  const products = Array.from(new Map(items.map((b) => [b.productId, b.product])).entries());

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post("/api/batches", {
        batchNo: form.batchNo,
        productId: form.productId || products[0]?.[0],
        issuedQty: Number(form.issuedQty),
        mfgDate: new Date(form.mfgDate).toISOString(),
        expiryDate: new Date(form.expiryDate).toISOString(),
      });
      setOpen(false);
      setForm({ batchNo: "", productId: "", issuedQty: "", mfgDate: "", expiryDate: "" });
      await reload();
    } catch (err) {
      if (err instanceof ApiFailure) setError(err.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Issued batch registry</h1>
          <p className="mt-1 text-sm text-ink-700">
            The issued quantity is the ceiling every mass-balance check is measured against.
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>Register batch</Button>
      </div>

      {loading ? (
        <Card>
          <Empty>Loading…</Empty>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <Empty>No batches registered.</Empty>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {items.map((b) => (
            <Card key={b.id}>
              <CardHeader
                title={`${b.product} · ${b.batchNo}`}
                subtitle={`Expires ${b.expiryDate.slice(0, 10)} · ${b.daysLeft} days`}
                right={
                  <div className="flex gap-1.5">
                    <Chip tone={expiryTone[b.expiryState]}>{b.expiryState}</Chip>
                    <Chip tone={registryTone[b.registryStatus]}>{b.registryStatus}</Chip>
                  </div>
                }
              />
              <div className="flex gap-5 px-5 py-5">
                <div className="min-w-0 flex-1">
                  <p className="text-xs uppercase tracking-wide text-ink-500">Batch health</p>
                  <div className="mt-2">
                    <StackedBar
                      total={b.health.issued}
                      segments={[
                        { label: "billed", value: b.health.billed, className: "bg-blue-500" },
                        { label: "returned", value: b.health.returned, className: "bg-amber-500" },
                        { label: "destroyed", value: b.health.destroyed, className: "bg-ink-700" },
                        { label: "unaccounted", value: b.health.leaked, className: "bg-red-500" },
                      ]}
                    />
                  </div>
                  <p className="mt-3 text-xs text-ink-700">
                    Issued {b.health.issued} · headroom {Math.max(0, b.health.issued - b.health.billed)}
                  </p>
                  {b.destroyedAt ? (
                    <p className="mt-1 text-xs font-medium text-red-700">
                      Destroyed {b.destroyedAt.slice(0, 10)}
                    </p>
                  ) : null}
                </div>
                <div className="shrink-0 text-center">
                  <VerifyQR licenseNo={b.manufacturerLicenseNo} batchNo={b.batchNo} size={110} />
                  <p className="mt-1.5 text-[11px] text-ink-500">Scan to verify</p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Register batch">
        <form onSubmit={create} className="space-y-4">
          <Field label="Batch number">
            <Input
              value={form.batchNo}
              onChange={(e) => setForm({ ...form, batchNo: e.target.value })}
              className="font-mono"
              required
            />
          </Field>
          <Field label="Product">
            <Select value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })}>
              {products.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Issued quantity" hint="Units released. This is the ceiling for I1.">
            <Input
              type="number"
              min={1}
              value={form.issuedQty}
              onChange={(e) => setForm({ ...form, issuedQty: e.target.value })}
              required
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Manufacture date">
              <Input type="date" value={form.mfgDate} onChange={(e) => setForm({ ...form, mfgDate: e.target.value })} required />
            </Field>
            <Field label="Expiry date">
              <Input type="date" value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} required />
            </Field>
          </div>
          <ErrorBanner error={error} />
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Registering…" : "Register"}
          </Button>
        </form>
      </Modal>
    </div>
  );
}
