"use client";

import { useState } from "react";
import { useApi } from "@/lib/client";
import { Card, CardHeader, Chip, Empty, Select, StackedBar, Table, Td } from "@/components/ui";
import { Stat, Verdict } from "@/components/verdict";

interface Location {
  orgId: string;
  orgName: string;
  orgType: string;
  licenseNo: string;
  district: string;
  received: number;
  sold: number;
  onHand: number;
  expectedExpiredReturn: number;
  collected: number;
  unaccounted: number;
  balance: { balance: number; inbound: number; outbound: number };
  breach: { code: string; severity: string; shortfall: number } | null;
}

interface Account {
  batchNo: string;
  manufacturer: string;
  product: string;
  issuedQty: number;
  expiryDate: string;
  expired: boolean;
  totals: {
    issued: number;
    sold: number;
    returned: number;
    destroyed: number;
    leaked: number;
    outstanding: number;
    expectedExpiredReturn: number;
    collected: number;
    unaccounted: number;
  };
  locations: Location[];
  breaches: number;
}

interface BatchRow {
  id: string;
  batchNo: string;
  product: string;
  manufacturer: string;
  issuedQty: number;
  registryStatus: string;
}

export default function AccountabilityPage() {
  const { data: batches } = useApi<{ items: BatchRow[] }>("/api/batches");
  const [batchId, setBatchId] = useState<string>("");

  // Default to the batch with the largest issued quantity — the one whose
  // accounting story has the most in it.
  const list = batches?.items ?? [];
  const selected =
    batchId || [...list].sort((a, b) => b.issuedQty - a.issuedQty)[0]?.id || "";

  const { data, loading } = useApi<Account>(
    selected ? `/api/accountability/batch/${selected}` : null,
  );

  const t = data?.totals;
  const retail = (data?.locations ?? []).filter((l) => l.orgType === "RETAILER");
  const short = retail.filter((l) => l.unaccounted > 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Quantity accountability</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-700">
            Of the units this batch released, how many were sold, how many should have come
            back, and which pharmacies the rest sit behind.
          </p>
        </div>
        <div className="w-72">
          <Select value={selected} onChange={(e) => setBatchId(e.target.value)}>
            {list.map((b) => (
              <option key={b.id} value={b.id}>
                {b.batchNo} — {b.product} ({b.issuedQty.toLocaleString()})
              </option>
            ))}
          </Select>
        </div>
      </div>

      {loading || !data || !t ? (
        <Empty>Loading…</Empty>
      ) : (
        <>
          <Card className="p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div>
                <p className="text-lg font-bold tracking-tight">
                  {data.batchNo} — {data.product}
                </p>
                <p className="text-sm text-ink-700">{data.manufacturer}</p>
              </div>
              <Chip tone={data.expired ? "red" : "green"}>
                {data.expired ? "Expired" : "In date"} · {data.expiryDate.slice(0, 10)}
              </Chip>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-5">
              <Stat label="Issued" value={t.issued.toLocaleString()} />
              <Stat label="Sold to patients" value={t.sold.toLocaleString()} tone="green" />
              <Stat
                label="Never sold"
                value={t.outstanding.toLocaleString()}
                tone="amber"
                hint="must be disposed of"
              />
              <Stat label="Collected back" value={t.collected.toLocaleString()} tone="green" />
              <Stat
                label="Unaccounted"
                value={t.unaccounted.toLocaleString()}
                tone={t.unaccounted > 0 ? "red" : "green"}
                hint={t.unaccounted > 0 ? "still open" : "fully reconciled"}
              />
            </div>

            <div className="mt-5">
              <StackedBar
                total={t.issued}
                segments={[
                  { label: "Sold", value: t.sold, className: "bg-emerald-500" },
                  { label: "Collected", value: t.collected, className: "bg-sky-500" },
                  { label: "Unaccounted", value: t.unaccounted, className: "bg-red-500" },
                ]}
              />
            </div>
          </Card>

          {data.expired && t.unaccounted > 0 ? (
            <Verdict
              tone="red"
              headline={`${t.unaccounted.toLocaleString()} units unaccounted for`}
              what="EXPIRED STOCK NOT RETURNED"
              why={`This batch expired on ${data.expiryDate.slice(0, 10)}. ${t.outstanding.toLocaleString()} units were never sold and had to come back for destruction. ${t.collected.toLocaleString()} did. ${t.unaccounted.toLocaleString()} did not.`}
              action={
                short.length
                  ? `Ask ${short.map((l) => `${l.orgName} (${l.unaccounted})`).join(" and ")} where the remaining stock is. It stays open until they account for it.`
                  : "Chase the outstanding return through the pipeline."
              }
              rule="Expiry accountability — a quantity requiring disposition, not yet a finding of diversion"
            />
          ) : data.expired ? (
            <Verdict
              tone="green"
              headline="Fully reconciled"
              what="EXPIRED STOCK ALL ACCOUNTED FOR"
              why={`Everything not sold to a patient — ${t.outstanding.toLocaleString()} units — has entered the return pipeline.`}
              action="Nothing to chase. Follow the returns through to certified destruction."
            />
          ) : (
            <Verdict
              tone="slate"
              headline="In date — nothing due back yet"
              why={`${t.outstanding.toLocaleString()} units are still on shelves legitimately. The disposal obligation begins at expiry on ${data.expiryDate.slice(0, 10)}.`}
              action="No action. This becomes a return obligation once the batch expires."
            />
          )}

          <Card>
            <CardHeader
              title="Where the units are"
              subtitle="Derived from the append-only ledger. Nobody types these figures in."
            />
            {retail.length === 0 ? (
              <Empty>This batch has not reached a pharmacy yet.</Empty>
            ) : (
              <Table
                head={[
                  "Pharmacy",
                  "District",
                  "Received",
                  "Sold",
                  "On hand",
                  "Should return",
                  "Returned",
                  "Unaccounted",
                ]}
              >
                {retail.map((l) => (
                  <tr key={l.orgId} className={l.unaccounted > 0 ? "bg-red-50/60" : undefined}>
                    <Td className="font-medium">
                      {l.orgName}
                      {l.breach ? (
                        <Chip tone="red" className="ml-2">
                          I7 books do not balance
                        </Chip>
                      ) : null}
                      <span className="block font-mono text-xs text-ink-500">{l.licenseNo}</span>
                    </Td>
                    <Td className="text-ink-700">{l.district}</Td>
                    <Td className="tabular-nums">{l.received.toLocaleString()}</Td>
                    <Td className="tabular-nums">{l.sold.toLocaleString()}</Td>
                    <Td className="tabular-nums">{l.onHand.toLocaleString()}</Td>
                    <Td className="tabular-nums">{l.expectedExpiredReturn.toLocaleString()}</Td>
                    <Td className="tabular-nums">{l.collected.toLocaleString()}</Td>
                    <Td
                      className={
                        l.unaccounted > 0
                          ? "font-bold tabular-nums text-red-700"
                          : "tabular-nums text-ink-400"
                      }
                    >
                      {l.unaccounted.toLocaleString()}
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
            <p className="border-t border-line px-5 py-3 text-xs text-ink-500">
              A gap here means the units were not recorded as returned. That is a question to put
              to the pharmacy, not a finding against it — stock destroyed locally without being
              recorded looks identical to stock diverted.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
