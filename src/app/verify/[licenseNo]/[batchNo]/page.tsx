// SPEC §6.6 — public verification. Mobile-first, no auth, no nav.
//
// Server-rendered so a phone gets the answer in one request with no JS, and so
// the page works when scanned from a QR on a laptop screen.

import { licenseCandidates } from "@/lib/license";
import { prisma } from "@/lib/db";
import { checkNsqStatus } from "@/lib/cdsco";
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

  // Three DIFFERENT questions, answered separately and never merged:
  //
  //   the card above  — what does the manufacturer's register say about this batch?
  //   the receipt     — what did OUR checks conclude the last time it was seen?
  //   the CDSCO panel — has the REGULATOR flagged this batch on quality?
  //
  // A batch can be clean on one and damning on another. Collapsing them into a
  // single verdict would destroy exactly the information that matters.
  const bill = batch
    ? await prisma.bill.findFirst({
        where: { batchId: batch.id },
        orderBy: { generatedAt: "desc" },
      })
    : null;

  const nsq = batch
    ? checkNsqStatus(
        batch.product.name,
        batch.batchNo,
        await prisma.nsqAlert.findMany({ where: { batchNo: batch.batchNo } }),
      )
    : null;

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col px-4 py-8">
      <p className="text-center text-xs font-semibold uppercase tracking-widest text-ink-500">
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
        <dl className="mt-6 divide-y divide-line rounded-xl border border-line bg-surface text-sm">
          {[
            ["Product", `${batch.product.name} (${batch.product.form})`],
            ["Manufacturer", batch.manufacturer.name],
            ["Licence", batch.manufacturer.licenseNo],
            ["Expiry", batch.expiryDate.toISOString().slice(0, 10)],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 px-4 py-3">
              <dt className="text-ink-500">{k}</dt>
              <dd className="text-right font-medium text-ink-900">{v}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <div className="mt-6 rounded-xl border border-line bg-surface px-4 py-3 text-sm text-ink-700">
          Searched for licence <span className="font-mono">{licenseNo}</span>.
        </div>
      )}

      {bill ? (
        <section
          className={`mt-4 rounded-xl border-2 px-4 py-4 ${
            bill.status === "EXPIRED" ? "border-red-300 bg-red-50" : "border-emerald-300 bg-emerald-50"
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-700">
              Last compliance check
            </p>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                bill.status === "EXPIRED" ? "bg-red-600 text-white" : "bg-emerald-600 text-white"
              }`}
            >
              {bill.status === "EXPIRED" ? "NOT ACCEPTABLE" : "OK"}
            </span>
          </div>
          <p
            className={`mt-2 text-sm font-medium leading-relaxed ${
              bill.status === "EXPIRED" ? "text-red-900" : "text-emerald-900"
            }`}
          >
            {bill.anomalyNote ?? "No compliance findings were recorded against this batch."}
          </p>
          <p className="mt-2 text-xs text-ink-700">
            Recorded {bill.generatedAt.toISOString().slice(0, 10)}. This receipt is permanent — it is
            never edited or withdrawn.
          </p>
        </section>
      ) : null}

      {nsq ? (
        <section
          className={`mt-4 rounded-xl border-2 px-4 py-4 ${
            nsq.flagged ? "border-amber-400 bg-amber-50" : "border-line bg-surface"
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-700">
              CDSCO quality alert
            </p>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                nsq.flagged ? "bg-amber-600 text-white" : "bg-line text-ink-700"
              }`}
            >
              {nsq.flagged ? "NSQ FLAGGED" : "NOT FLAGGED"}
            </span>
          </div>
          <p
            className={`mt-2 text-sm leading-relaxed ${nsq.flagged ? "font-medium text-amber-900" : "text-ink-700"}`}
          >
            {nsq.message}
          </p>
          <p className="mt-2 text-xs text-ink-700">
            This is the drug regulator&apos;s own quality finding. It is a separate question from the
            compliance check above, and one can be clear while the other is not.
          </p>
        </section>
      ) : null}

      <p className="mt-6 text-center text-xs leading-relaxed text-ink-500">
        Checked against the manufacturer&apos;s issued batch registry at{" "}
        {now.toISOString().slice(0, 16).replace("T", " ")} UTC. This service records batch status; it
        cannot confirm that a physical pack is genuine.
      </p>
    </div>
  );
}
