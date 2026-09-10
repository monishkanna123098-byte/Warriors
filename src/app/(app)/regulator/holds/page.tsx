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
  registryTone,
} from "@/components/ui";

interface Order {
  id: string;
  batchId: string;
  batchNo: string;
  product: string;
  manufacturer: string;
  registryStatus: string;
  action: string;
  reason: string;
  releasesId: string | null;
  createdAt: string;
}
interface BatchRow {
  id: string;
  batchNo: string;
  product: string;
  manufacturer: string;
  registryStatus: string;
}

const ACTION_LABEL: Record<string, string> = {
  HOLD_ISSUED: "Hold issued",
  RECALL_ISSUED: "Recall issued",
  RELEASED: "Released",
};

export default function HoldsPage() {
  const orders = useApi<{ items: Order[] }>("/api/regulator/holds");
  const batches = useApi<{ items: BatchRow[] }>("/api/batches");

  const [batchId, setBatchId] = useState("");
  const [action, setAction] = useState("RECALL_ISSUED");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const list = batches.data?.items ?? [];
  const chosen = list.find((b) => b.id === batchId);

  // What the batch's current status actually permits. Offering an action the
  // service will refuse is a worse experience than not offering it.
  const canHold = chosen?.registryStatus === "CLEAN";
  const canRecall = chosen?.registryStatus === "CLEAN" || chosen?.registryStatus === "HELD";
  const canRelease = chosen?.registryStatus === "HELD" || chosen?.registryStatus === "RECALLED";

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await post("/api/regulator/holds", { batchId, action, reason });
      setReason("");
      await Promise.all([orders.reload(), batches.reload()]);
    } catch (e) {
      setError(e instanceof ApiFailure ? e.error : { code: "CONFLICT", message: String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Holds and recalls</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">
          A recalled batch is blocked at every counter, on the public verify page, and on any
          consumer receipt that carries it — immediately, without the receipt being reprinted.
        </p>
      </div>

      <Card>
        <CardHeader
          title="Issue or lift an order"
          subtitle="Every action needs a written reason. A release is a new order naming the one it lifts; the original stays on the record for good."
        />
        <div className="space-y-4 p-5">
          <ErrorBanner error={error} />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Batch">
              <Select value={batchId} onChange={(e) => setBatchId(e.target.value)}>
                <option value="">Choose a batch…</option>
                {list.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.batchNo} — {b.product} ({b.registryStatus})
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="Action"
              hint={
                chosen
                  ? `${chosen.batchNo} is currently ${chosen.registryStatus}.`
                  : "Choose a batch first."
              }
            >
              <Select value={action} onChange={(e) => setAction(e.target.value)}>
                <option value="RECALL_ISSUED" disabled={!canRecall}>
                  Recall — withdraw from sale and pull stock back
                </option>
                <option value="HOLD_ISSUED" disabled={!canHold}>
                  Hold — freeze sale pending investigation
                </option>
                <option value="RELEASED" disabled={!canRelease}>
                  Release — lift the order in force
                </option>
              </Select>
            </Field>
          </div>

          <Field
            label="Reason"
            hint="Recorded permanently and shown to the manufacturer. At least 8 characters."
          >
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Dissolution failure confirmed on two retained samples…"
            />
          </Field>

          <Button onClick={submit} disabled={busy || !batchId || reason.trim().length < 8}>
            {busy ? "Recording…" : "Record this order"}
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader title="Order history" subtitle="Append-only. Nothing here is ever edited or removed." />
        {orders.loading ? (
          <Empty>Loading…</Empty>
        ) : (orders.data?.items ?? []).length === 0 ? (
          <Empty>No holds or recalls have been issued.</Empty>
        ) : (
          <Table head={["Batch", "Action", "Reason", "Batch status now", "When"]}>
            {(orders.data?.items ?? []).map((o) => (
              <tr key={o.id}>
                <Td className="font-medium">
                  {o.batchNo}
                  <span className="block text-xs text-slate-500">
                    {o.product} · {o.manufacturer}
                  </span>
                </Td>
                <Td>
                  <Chip tone={o.action === "RELEASED" ? "green" : o.action === "RECALL_ISSUED" ? "red" : "amber"}>
                    {ACTION_LABEL[o.action] ?? o.action}
                  </Chip>
                  {o.releasesId ? (
                    <span className="mt-1 block font-mono text-xs text-slate-500">
                      lifts {o.releasesId.slice(-8)}
                    </span>
                  ) : null}
                </Td>
                <Td className="max-w-md text-slate-700">{o.reason}</Td>
                <Td>
                  <Chip tone={registryTone[o.registryStatus] ?? "grey"}>{o.registryStatus}</Chip>
                </Td>
                <Td className="text-xs text-slate-500">{o.createdAt.slice(0, 16).replace("T", " ")}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
