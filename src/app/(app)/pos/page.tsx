"use client";

// SPEC §6.1 — the demo surface. The verdict renders full-width in large type:
// green ALLOW, red BLOCK with the alert code and message.

import { useState } from "react";
import { ApiFailure, post, useApi } from "@/lib/client";
import { Button, Card, CardHeader, Chip, Field, Input, Select } from "@/components/ui";
import { cn } from "@/lib/cn";

interface Org {
  id: string;
  name: string;
  licenseNo: string;
}

interface ScanResponse {
  verdict: "ALLOW" | "BLOCK";
  alertCode: string | null;
  severity: string | null;
  message: string;
  serverTs: string;
  batch: {
    batchNo: string;
    manufacturer: string;
    manufacturerLicenseNo: string;
    product: string;
    issuedQty: number;
    billedSum: number;
    expiryDate: string;
    registryStatus: string;
  } | null;
  secondaryAlerts: { code: string; severity: string }[];
  /** Compliance receipt for this decision. EXPIRED hard-blocks the terminal. */
  bill: { status: "OK" | "EXPIRED"; anomalyNote: string | null } | null;
}

export default function PosPage() {
  const { data: orgs } = useApi<{ items: Org[] }>("/api/orgs?type=MANUFACTURER");
  const [manufacturerRef, setManufacturerRef] = useState("");
  const [batchNo, setBatchNo] = useState("");
  const [qty, setQty] = useState("1");
  const [context, setContext] = useState<"SALE" | "RETURN_INTAKE">("SALE");
  const [claimedInvoiceDate, setClaimedInvoiceDate] = useState("");
  const [result, setResult] = useState<ScanResponse | null>(null);
  const [busy, setBusy] = useState(false);

  const manufacturers = orgs?.items ?? [];
  const effectiveRef = manufacturerRef || manufacturers[0]?.licenseNo || "";

  async function scan(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await post<ScanResponse>("/api/pos/scan", {
        manufacturerRef: effectiveRef,
        batchNo,
        qty: Number(qty),
        context,
        claimedInvoiceDate: claimedInvoiceDate ? new Date(claimedInvoiceDate).toISOString() : null,
      });
      setResult(res);
    } catch (err) {
      if (err instanceof ApiFailure) {
        setResult({
          verdict: "BLOCK",
          alertCode: err.error.code,
          severity: "HIGH",
          message: err.error.message,
          serverTs: new Date().toISOString(),
          batch: null,
          secondaryAlerts: [],
          bill: null,
        });
      }
    } finally {
      setBusy(false);
    }
  }

  const blocked = result?.verdict === "BLOCK";

  // A receipt marked EXPIRED means this stock is not acceptable. The terminal is
  // then hard-blocked: the scan form is removed from the page entirely, and no
  // control anywhere continues with this item. There is no override for any
  // role — not in the UI, and not on any API route.
  const hardBlocked = result?.bill?.status === "EXPIRED";

  function clearForNextItem() {
    setResult(null);
    setBatchNo("");
    setQty("1");
    setClaimedInvoiceDate("");
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">POS terminal</h1>
        <p className="mt-1 text-sm text-slate-600">
          Every scan is decided on the server clock and written to the scan log whatever the verdict.
        </p>
      </div>

      {result ? (
        <div
          className={cn(
            "rounded-xl border-2 px-8 py-10 text-center",
            blocked ? "border-red-300 bg-red-50" : "border-emerald-300 bg-emerald-50",
          )}
        >
          <p
            className={cn(
              "text-6xl font-black tracking-tight md:text-7xl",
              blocked ? "text-red-700" : "text-emerald-700",
            )}
          >
            {result.verdict}
          </p>
          {result.alertCode ? (
            <p className="mt-3 font-mono text-2xl font-bold tracking-tight text-red-800 md:text-3xl">
              {result.alertCode}
            </p>
          ) : null}
          <p
            className={cn(
              "mx-auto mt-4 max-w-2xl text-lg font-medium md:text-xl",
              blocked ? "text-red-900" : "text-emerald-900",
            )}
          >
            {result.message}
          </p>

          {result.secondaryAlerts.length > 0 ? (
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {result.secondaryAlerts.map((a) => (
                <Chip key={a.code} tone="amber">
                  also raised: {a.code} ({a.severity})
                </Chip>
              ))}
            </div>
          ) : null}

          {result.batch ? (
            <dl className="mx-auto mt-7 grid max-w-2xl grid-cols-2 gap-x-6 gap-y-2 border-t border-slate-300/60 pt-5 text-left text-sm md:grid-cols-4">
              {[
                ["Product", result.batch.product],
                ["Batch", result.batch.batchNo],
                ["Manufacturer", result.batch.manufacturer],
                ["Expiry", result.batch.expiryDate.slice(0, 10)],
                ["Registry", result.batch.registryStatus],
                ["Issued", String(result.batch.issuedQty)],
                ["Billed", String(result.batch.billedSum)],
                ["Decided at", new Date(result.serverTs).toLocaleTimeString()],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs uppercase tracking-wide text-slate-500">{k}</dt>
                  <dd className="font-medium text-slate-900">{v}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      ) : null}

      {result?.bill ? (
        <Card
          className={cn(
            "border-2",
            result.bill.status === "EXPIRED" ? "border-red-400 bg-red-50" : "border-emerald-300 bg-emerald-50",
          )}
        >
          <CardHeader
            title="Compliance receipt"
            subtitle="A permanent record of this decision. It is never edited or reissued."
            right={
              <Chip tone={result.bill.status === "EXPIRED" ? "red" : "green"}>
                {result.bill.status === "EXPIRED" ? "NOT ACCEPTABLE" : "OK"}
              </Chip>
            }
          />
          <div className="px-5 py-5">
            {result.bill.status === "EXPIRED" ? (
              <>
                <p className="text-2xl font-bold tracking-tight text-red-800">
                  EXPIRED — {result.bill.anomalyNote}
                </p>
                <dl className="mt-5 space-y-3 border-t border-red-200 pt-4 text-sm">
                  <div>
                    <dt className="font-semibold text-red-900">What happened</dt>
                    <dd className="text-red-800">
                      This item was checked against the manufacturer&apos;s issued register and the
                      movement ledger, and refused.
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-red-900">Why it happened</dt>
                    <dd className="text-red-800">{result.bill.anomalyNote}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-red-900">What happens next</dt>
                    <dd className="text-red-800">
                      Set this stock aside — do not dispense or sell it. The refusal is now a
                      permanent receipt, visible to the regulator and to anyone who looks this batch
                      up publicly. It cannot be reversed by any member of staff.
                    </dd>
                  </div>
                </dl>
                <p className="mt-5 rounded-md bg-red-100 px-4 py-2.5 text-sm font-semibold text-red-900">
                  There is no override. No manager, pharmacist or administrator can continue with
                  this item.
                </p>
              </>
            ) : (
              <p className="text-lg font-medium text-emerald-900">
                No compliance findings. This batch is in date and within the quantity its
                manufacturer released.
              </p>
            )}
          </div>
        </Card>
      ) : null}

      {hardBlocked ? (
        <Card className="border-slate-300 p-5">
          <p className="text-sm text-slate-700">
            The terminal is blocked on this item. You may start a different one — the refusal above
            stays on the record either way.
          </p>
          <Button variant="ghost" className="mt-3" onClick={clearForNextItem}>
            Clear and scan a different item
          </Button>
        </Card>
      ) : (
      <Card>
        <CardHeader title="Scan" subtitle="Batch numbers collide across manufacturers — both fields are required." />
        <form onSubmit={scan} className="grid gap-4 px-5 py-5 md:grid-cols-2">
          <Field label="Manufacturer">
            <Select value={effectiveRef} onChange={(e) => setManufacturerRef(e.target.value)}>
              {manufacturers.map((m) => (
                <option key={m.id} value={m.licenseNo}>
                  {m.name} — {m.licenseNo}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Batch number">
            <Input
              value={batchNo}
              onChange={(e) => setBatchNo(e.target.value)}
              placeholder="B-1001"
              required
              autoFocus
              className="font-mono text-lg"
            />
          </Field>
          <Field label="Quantity">
            <Input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} required />
          </Field>
          <Field label="Context">
            <div className="flex gap-2">
              {(["SALE", "RETURN_INTAKE"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setContext(c)}
                  className={cn(
                    "flex-1 rounded-md border px-3 py-2 text-sm font-medium",
                    context === c
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
          </Field>
          <Field
            label="Claimed invoice date (optional)"
            hint="Evidence only. The verdict always uses the server clock; a claim more than 24h old raises BACKDATED_INVOICE alongside it."
          >
            <Input
              type="datetime-local"
              value={claimedInvoiceDate}
              onChange={(e) => setClaimedInvoiceDate(e.target.value)}
            />
          </Field>
          <div className="flex items-end">
            <Button type="submit" disabled={busy} className="h-11 w-full text-base">
              {busy ? "Deciding…" : "Scan"}
            </Button>
          </div>
        </form>
      </Card>
      )}
    </div>
  );
}
