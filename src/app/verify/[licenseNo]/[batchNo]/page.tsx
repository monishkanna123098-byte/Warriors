// SPEC §6.6 — public verification. Mobile-first, no auth, no nav.
//
// Server-rendered so a phone gets the answer in one request with no JS, and so
// the page works when scanned from a QR on a laptop screen.

import { licenseCandidates } from "@/lib/license";
import { prisma } from "@/lib/db";
import { RegistryStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

type Tone = "red" | "amber" | "green";

const TONES: Record<Tone, { card: string; badge: string; head: string }> = {
  red: { card: "bg-red-600", badge: "bg-red-800/40", head: "text-white" },
  amber: { card: "bg-amber-500", badge: "bg-amber-700/30", head: "text-white" },
  green: { card: "bg-emerald-600", badge: "bg-emerald-800/40", head: "text-white" },
};

async function lookup(licenseNo: string, batchNo: string) {
  const orgs = await prisma.organization.findMany({
    where: { type: "MANUFACTURER", licenseNo: { in: licenseCandidates(licenseNo) } },
  });
  // An ambiguous slug is unresolved rather than guessed at.
  const manufacturer = orgs.length === 1 ? orgs[0] : null;
  if (!manufacturer) return null;

  return prisma.batch.findUnique({
    where: { manufacturerId_batchNo: { manufacturerId: manufacturer.id, batchNo: batchNo.toUpperCase() } },
    include: { manufacturer: true, product: true },
  });
}

export default async function VerifyPage({
  params,
}: {
  params: { licenseNo: string; batchNo: string };
}) {
  const licenseNo = decodeURIComponent(params.licenseNo);
  const batchNo = decodeURIComponent(params.batchNo).trim().toUpperCase();
  const now = new Date();

  const batch = await lookup(licenseNo, batchNo);

  let tone: Tone = "green";
  let headline = "Valid";
  let message = "Valid.";

  if (!batch) {
    tone = "red";
    headline = "No record of this batch";
    message = "No record of this batch. Do not consume.";
  } else if (batch.registryStatus === RegistryStatus.DESTROYED) {
    tone = "red";
    headline = "Destroyed batch";
    message = `This batch was destroyed on ${batch.destroyedAt?.toISOString().slice(0, 10) ?? "an earlier date"}. Report to ${batch.manufacturer.stateCode} state drug controller.`;
  } else if (batch.registryStatus === RegistryStatus.IN_RETURN_PIPELINE) {
    tone = "amber";
    headline = "Withdrawn from sale";
    message = "This batch is expired and withdrawn from sale.";
  } else if (now > batch.expiryDate) {
    tone = "amber";
    headline = "Expired";
    message = `This batch expired on ${batch.expiryDate.toISOString().slice(0, 10)}.`;
  }

  const t = TONES[tone];

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col px-4 py-8">
      <p className="text-center text-xs font-semibold uppercase tracking-widest text-slate-500">
        Batch verification
      </p>

      <div className={`mt-5 rounded-2xl px-6 py-10 text-center shadow-lg ${t.card}`}>
        <p className={`text-3xl font-black leading-tight tracking-tight ${t.head}`}>{headline}</p>
        <p className="mt-4 text-base font-medium leading-relaxed text-white/95">{message}</p>
        <p className={`mt-6 inline-block rounded-full px-4 py-1.5 font-mono text-sm text-white ${t.badge}`}>
          {batchNo}
        </p>
      </div>

      {batch ? (
        <dl className="mt-6 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white text-sm">
          {[
            ["Product", `${batch.product.name} (${batch.product.form})`],
            ["Manufacturer", batch.manufacturer.name],
            ["Licence", batch.manufacturer.licenseNo],
            ["Expiry", batch.expiryDate.toISOString().slice(0, 10)],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 px-4 py-3">
              <dt className="text-slate-500">{k}</dt>
              <dd className="text-right font-medium text-slate-900">{v}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <div className="mt-6 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
          Searched for licence <span className="font-mono">{licenseNo}</span>.
        </div>
      )}

      <p className="mt-6 text-center text-xs leading-relaxed text-slate-500">
        Checked against the manufacturer&apos;s issued batch registry at{" "}
        {now.toISOString().slice(0, 16).replace("T", " ")} UTC. This service records batch status; it
        cannot confirm that a physical pack is genuine.
      </p>
    </div>
  );
}
