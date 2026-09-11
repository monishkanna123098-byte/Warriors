"use client";

import { useState } from "react";
import { useApi, post, ApiFailure } from "@/lib/client";

interface Line {
  product: string;
  manufacturer: string;
  manufacturerLicenseNo: string;
  batchNo: string;
  qty: number;
  expiryDisplay: string;
  status: string;
  headline: string;
  explanation: string;
  action: string;
  safe: boolean;
}
interface Bill {
  billNo: string;
  pharmacy: string;
  pharmacyLicenseNo: string;
  purchaseDisplay: string;
  lines: Line[];
  allSafe: boolean;
  simulated: boolean;
  evaluatedAt: string;
}

const TONE: Record<string, { card: string; band: string; text: string }> = {
  VALID: { card: "border-emerald-300 bg-emerald-50", band: "bg-emerald-600", text: "text-emerald-900" },
  EXPIRED: { card: "border-red-300 bg-red-50", band: "bg-red-600", text: "text-red-900" },
  RECALLED: { card: "border-red-400 bg-red-50", band: "bg-red-700", text: "text-red-900" },
  DESTROYED: { card: "border-red-400 bg-red-50", band: "bg-red-700", text: "text-red-900" },
  HELD: { card: "border-amber-300 bg-amber-50", band: "bg-amber-500", text: "text-amber-900" },
  UNKNOWN: { card: "border-ink-400 bg-sunken", band: "bg-ink-700", text: "text-ink-900" },
};

const REASONS = [
  ["SUSPECTED_EXPIRED", "It looks out of date"],
  ["SUSPECTED_COUNTERFEIT", "I think it might be fake"],
  ["PACKAGING_TAMPERED", "The packaging looks tampered with"],
  ["ADVERSE_REACTION", "It made me unwell"],
  ["SOLD_AFTER_RECALL", "I was sold it after a recall"],
  ["OTHER", "Something else"],
] as const;

/** Today, one month on, one year on — the control is forward-only by design. */
const LENSES = [
  { label: "Today", days: 0 },
  { label: "+1 month", days: 30 },
  { label: "+1 year", days: 365 },
];

export default function ConsumerBillPage({ params }: { params: { token: string } }) {
  const token = decodeURIComponent(params.token);
  const [days, setDays] = useState(0);

  const asOf = days === 0 ? "" : `?asOf=${new Date(Date.now() + days * 24 * 36e5).toISOString()}`;
  const { data, loading, error } = useApi<Bill>(`/api/verify/bill/${token}${asOf}`);

  const [reporting, setReporting] = useState<Line | null>(null);
  const [reason, setReason] = useState<string>("SUSPECTED_COUNTERFEIT");
  const [note, setNote] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function report() {
    if (!reporting) return;
    setBusy(true);
    try {
      const r = await post<{ reference: string }>("/api/citizen-reports", {
        manufacturerRef: reporting.manufacturerLicenseNo,
        batchNo: reporting.batchNo,
        reason,
        description: note || null,
      });
      setSent(r.reference);
      setReporting(null);
      setNote("");
    } catch (e) {
      setSent(e instanceof ApiFailure ? `Could not send: ${e.error.message}` : "Could not send.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Shell><p className="text-ink-700">Checking…</p></Shell>;
  if (error || !data)
    return (
      <Shell>
        <div className="rounded-xl border-2 border-ink-400 bg-sunken p-6">
          <p className="text-2xl font-bold text-ink-900">No record found</p>
          <p className="mt-2 text-ink-700">
            This code does not match any purchase we hold. Do not take the medicine. Take it back
            to the pharmacy and ask them to check the batch number.
          </p>
        </div>
      </Shell>
    );

  return (
    <Shell>
      <div className="mb-6">
        <p className="text-xs uppercase tracking-wide text-ink-500">Your purchase</p>
        <h1 className="text-2xl font-bold tracking-tight">{data.billNo}</h1>
        <p className="mt-1 text-sm text-ink-700">
          {data.pharmacy} · bought {data.purchaseDisplay}
        </p>
      </div>

      <div className="mb-6 rounded-lg border border-line bg-surface p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
          Check as if it were
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {LENSES.map((l) => (
            <button
              key={l.days}
              onClick={() => setDays(l.days)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                days === l.days
                  ? "bg-ink-900 text-white"
                  : "bg-sunken text-ink-700 hover:bg-line"
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
        {data.simulated ? (
          <p className="mt-3 rounded bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <strong>Demonstration only.</strong> Showing what this medicine would say on{" "}
            {data.evaluatedAt.slice(0, 10).split("-").reverse().join("/")}. Nothing has been
            changed — the expiry date and the purchase record are exactly as they were.
          </p>
        ) : (
          <p className="mt-3 text-xs text-ink-500">
            Checked against the real date and time on our server, not on your phone.
          </p>
        )}
      </div>

      {sent ? (
        <div className="mb-6 rounded-lg border border-sky-300 bg-sky-50 p-4 text-sm text-sky-900">
          Thank you — your report has been passed to the regulator. Reference{" "}
          <strong className="font-mono">{sent}</strong>. It is treated as something for them to
          look into, not as a finding against the medicine.
        </div>
      ) : null}

      <div className="space-y-4">
        {data.lines.map((l, i) => {
          const tone = TONE[l.status] ?? TONE.UNKNOWN;
          return (
            <div key={i} className={`overflow-hidden rounded-xl border-2 ${tone.card}`}>
              <div className={`h-2 w-full ${tone.band}`} />
              <div className="p-5">
                <p className={`text-xl font-bold tracking-tight ${tone.text}`}>{l.headline}</p>
                <p className="mt-2 text-lg font-semibold text-ink-900">{l.product}</p>
                <p className="text-sm text-ink-700">{l.explanation}</p>

                <p className="mt-3 rounded bg-surface/70 px-3 py-2 text-sm font-medium text-ink-900">
                  {l.action}
                </p>

                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-black/10 pt-4 text-sm sm:grid-cols-4">
                  <Detail label="Manufacturer" value={l.manufacturer} />
                  <Detail label="Batch" value={l.batchNo} mono />
                  <Detail label="You bought" value={`${l.qty} ${l.qty === 1 ? "unit" : "units"}`} />
                  <Detail label="Expires" value={l.expiryDisplay} />
                </dl>

                <button
                  onClick={() => setReporting(l)}
                  className="mt-4 rounded-lg border border-line-strong bg-surface px-4 py-2 text-sm font-semibold text-ink-900 hover:bg-sunken"
                >
                  Report this medicine
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {reporting ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="w-full max-w-lg rounded-xl bg-surface p-5 shadow-xl">
            <h2 className="text-lg font-bold">Report {reporting.batchNo}</h2>
            <p className="mt-1 text-sm text-ink-700">
              No account needed. Your report goes to the drugs controller as something to look
              into.
            </p>

            <div className="mt-4 space-y-2">
              {REASONS.map(([value, label]) => (
                <label
                  key={value}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border border-line px-3 py-2 text-sm hover:bg-sunken"
                >
                  <input
                    type="radio"
                    name="reason"
                    checked={reason === value}
                    onChange={() => setReason(value)}
                  />
                  {label}
                </label>
              ))}
            </div>

            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Anything else you noticed (optional)"
              className="mt-3 w-full rounded-lg border border-line-strong px-3 py-2 text-sm"
            />

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setReporting(null)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-ink-700 hover:bg-sunken"
              >
                Cancel
              </button>
              <button
                onClick={report}
                disabled={busy}
                className="rounded-lg bg-ink-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy ? "Sending…" : "Send report"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </Shell>
  );
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className={`font-medium text-ink-900 ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl bg-sunken px-4 py-8">
      {children}
      <p className="mt-8 border-t border-line pt-4 text-xs text-ink-500">
        RCCP · Reverse Chain Compliance Platform. This page shows what was recorded when the
        medicine was dispensed and its status right now. It cannot tell you about medicine nobody
        recorded.
      </p>
    </main>
  );
}
