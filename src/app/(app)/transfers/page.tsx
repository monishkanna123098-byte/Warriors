"use client";

import { useState } from "react";
import { post, useApi, ApiFailure, type ApiError } from "@/lib/client";
import {
  Button,
  Card,
  CardHeader,
  Chip,
  Empty,
  ErrorBanner,
  Field,
  Input,
  Select,
  Table,
  Td,
} from "@/components/ui";
import { Verdict } from "@/components/verdict";

interface TransferRow {
  id: string;
  batchNo: string;
  product: string;
  from: string;
  to: string;
  qty: number;
  authorized: boolean;
  direction: string;
  note: string | null;
  serverTs: string;
}
interface Destination {
  id: string;
  name: string;
  type: string;
  licenseNo: string;
  district: string;
  /** Whether an authorised route covers this sender -> receiver pair. */
  authorized: boolean;
}
interface BatchRow {
  id: string;
  batchNo: string;
  product: string;
  registryStatus: string;
}

export default function TransfersPage() {
  const feed = useApi<{ items: TransferRow[]; destinations: Destination[] }>("/api/transfers");
  const inventory = useApi<{ items: { batchId: string; batchNo: string; product: string; qty: number }[] }>(
    "/api/inventory",
  );

  // A manufacturer dispatches from its own register; everyone else from what is
  // physically on their shelf. Asking for the register regardless worked — the
  // page fell back to inventory on the 403 — but it fired a forbidden request on
  // every load for every retailer and distributor, which logs a console error
  // and reads as a bug to anyone with devtools open.
  const me = useApi<{ organization: { type: string } }>("/api/me");
  const canReadRegister =
    me.data?.organization.type === "MANUFACTURER" || me.data?.organization.type === "REGULATOR";
  const batches = useApi<{ items: BatchRow[] }>(canReadRegister ? "/api/batches" : null);

  const [batchId, setBatchId] = useState("");
  const [toOrgId, setToOrgId] = useState("");
  const [qty, setQty] = useState("100");
  const [note, setNote] = useState("");
  const [error, setError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<{ message: string; authorized: boolean; senderBalanceAfter: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const destinations = feed.data?.destinations ?? [];
  const onRoute = destinations.filter((d) => d.authorized);
  const offRoute = destinations.filter((d) => !d.authorized);
  const chosenDestination = destinations.find((d) => d.id === toOrgId) ?? null;

  const options =
    (batches.data?.items ?? []).length > 0
      ? (batches.data?.items ?? []).map((b) => ({ id: b.id, label: `${b.batchNo} — ${b.product}` }))
      : (inventory.data?.items ?? []).map((i) => ({
          id: i.batchId,
          label: `${i.batchNo} — ${i.product} (${i.qty} on hand)`,
        }));

  async function submit() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await post<{ message: string; authorized: boolean; senderBalanceAfter: number }>(
        "/api/transfers",
        { batchId, toOrgId, qty: Number(qty), note: note || null },
      );
      setResult(r);
      setNote("");
      await Promise.all([feed.reload(), inventory.reload()]);
    } catch (e) {
      setError(e instanceof ApiFailure ? e.error : { code: "CONFLICT", message: String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Transfer stock</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-700">
          Every transfer writes both halves — units out of one organisation and into another, in
          one transaction. Quantity cannot appear or vanish because stock changed hands.
        </p>
      </div>

      <Card>
        <CardHeader title="Dispatch" />
        <div className="space-y-4 p-5">
          <ErrorBanner error={error} />
          {result ? (
            <Verdict
              tone={result.authorized ? "green" : "amber"}
              headline={result.authorized ? "Transfer recorded" : "Recorded — and flagged"}
              why={result.message}
              action={
                result.authorized
                  ? `The receiving organisation can now sell or return this stock. ${result.senderBalanceAfter} units of this batch remain here.`
                  : "The movement is on the record and the regulator will see it. Be ready to explain the routing."
              }
              rule={result.authorized ? null : "UNAUTHORIZED_ROUTE"}
            />
          ) : null}

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Batch">
              <Select value={batchId} onChange={(e) => setBatchId(e.target.value)}>
                <option value="">Choose…</option>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="To"
              hint={
                chosenDestination && !chosenDestination.authorized
                  ? undefined
                  : "Authorised routes are listed first."
              }
            >
              <Select value={toOrgId} onChange={(e) => setToOrgId(e.target.value)}>
                <option value="">Choose…</option>
                {onRoute.length > 0 ? (
                  <optgroup label="Authorised routes">
                    {onRoute.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} — {d.type.toLowerCase()}, {d.district}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {offRoute.length > 0 ? (
                  <optgroup label="Off-route — recorded and flagged">
                    {offRoute.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} — {d.type.toLowerCase()}, {d.district}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </Select>
            </Field>
            <Field label="Quantity">
              <Input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="numeric" />
            </Field>
          </div>

          {chosenDestination && !chosenDestination.authorized ? (
            <div className="flex gap-3 rounded-card border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <svg viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M10 3.2 18 16.8H2z" strokeLinejoin="round" />
                <path d="M10 8.4v3.4" strokeLinecap="round" />
                <circle cx="10" cy="14.2" r="0.85" fill="currentColor" stroke="none" />
              </svg>
              <div>
                <p className="font-medium">No authorised route to {chosenDestination.name}.</p>
                <p className="mt-1 leading-relaxed">
                  The transfer will still be recorded — refusing it would only push the stock off
                  the books — but it raises an <span className="font-mono text-xs">UNAUTHORIZED_ROUTE</span>{" "}
                  alert for the regulator, and you will be asked to explain the routing.
                </p>
              </div>
            </div>
          ) : null}

          <Field label="Note" hint="Optional.">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Weekly replenishment" />
          </Field>

          <Button onClick={submit} disabled={busy || !batchId || !toOrgId || Number(qty) < 1}>
            {busy ? "Recording…" : "Record transfer"}
          </Button>

          {!feed.loading && destinations.length === 0 ? (
            <p className="text-sm text-ink-500">
              There are no other organisations in the network to dispatch to.
            </p>
          ) : null}
        </div>
      </Card>

      <Card>
        <CardHeader title="Movement history" />
        {feed.loading ? (
          <Empty>Loading…</Empty>
        ) : (feed.data?.items ?? []).length === 0 ? (
          <Empty>No transfers yet.</Empty>
        ) : (
          <Table head={["", "Batch", "From", "To", "Qty", "Route", "When"]}>
            {(feed.data?.items ?? []).map((t) => (
              <tr key={t.id} className={t.authorized ? undefined : "bg-amber-50/60"}>
                <Td>
                  <Chip tone={t.direction === "OUT" ? "amber" : "green"}>{t.direction}</Chip>
                </Td>
                <Td className="font-medium">
                  {t.batchNo}
                  <span className="block text-xs text-ink-500">{t.product}</span>
                </Td>
                <Td className="text-ink-700">{t.from}</Td>
                <Td className="text-ink-700">{t.to}</Td>
                <Td className="tabular-nums">{t.qty.toLocaleString()}</Td>
                <Td>
                  {t.authorized ? (
                    <Chip tone="green">Authorised</Chip>
                  ) : (
                    <Chip tone="red">No authorised route</Chip>
                  )}
                </Td>
                <Td className="text-xs text-ink-500">{t.serverTs.slice(0, 16).replace("T", " ")}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
