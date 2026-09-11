"use client";

import Link from "next/link";
import { Reveal, useReveal } from "@/components/reveal";
import { FlipCard } from "./flip-card";
import { cn } from "@/lib/cn";

/* ---------------------------------------------------------------------------
   Shared section furniture — one heading treatment, one content width, so the
   page reads as one document rather than eight stacked components.
   --------------------------------------------------------------------------- */

export function Section({
  id,
  children,
  className,
  tone = "paper",
}: {
  id?: string;
  children: React.ReactNode;
  className?: string;
  tone?: "paper" | "sunken" | "ink";
}) {
  return (
    <section
      id={id}
      className={cn(
        "scroll-mt-28 px-5 py-20 sm:px-8 sm:py-24 lg:py-28",
        tone === "sunken" && "bg-sunken",
        tone === "ink" && "bg-ink-900 text-white",
        className,
      )}
    >
      <div className="mx-auto max-w-content">{children}</div>
    </section>
  );
}

export function SectionHead({
  eyebrow,
  title,
  lede,
  invert,
}: {
  eyebrow: string;
  title: string;
  lede?: string;
  invert?: boolean;
}) {
  return (
    <Reveal className="max-w-prose">
      <p
        className={cn(
          "text-[11px] font-semibold uppercase tracking-[0.16em]",
          invert ? "text-pine-300" : "text-pine-600",
        )}
      >
        {eyebrow}
      </p>
      <h2
        className={cn(
          "mt-3 font-display text-display-md font-semibold",
          invert ? "text-white" : "text-ink-900",
        )}
      >
        {title}
      </h2>
      {lede ? (
        <p className={cn("mt-4 text-[17px] leading-relaxed", invert ? "text-white/70" : "text-ink-700")}>
          {lede}
        </p>
      ) : null}
    </Reveal>
  );
}


/**
 * A list item that reveals itself.
 *
 * This exists so the hook is called at the top level of a component rather than
 * inside a .map callback — the Rules of Hooks are not a style preference: React
 * matches hooks to state by call order, so a conditional or looped call
 * silently binds the wrong state the moment a list length changes.
 */
function RevealLi({
  delay,
  className,
  children,
}: {
  delay: number;
  className?: string;
  children: React.ReactNode;
}) {
  const r = useReveal<HTMLLIElement>(delay);
  return (
    <li ref={r.ref} className={cn(r.className, className)} style={r.style}>
      {children}
    </li>
  );
}

/* --------------------------------------------------------------------------- */

const STATS = [
  { value: "10,000", label: "units issued in one batch", sub: "traced to five pharmacies" },
  { value: "8,000", label: "sold to patients", sub: "recorded batch by batch" },
  { value: "2,000", label: "never sold", sub: "owed back for destruction" },
  { value: "300", label: "never came back", sub: "and the system names who holds them" },
];

export function ProblemSection() {
  return (
    <Section id="problem" tone="sunken">
      <SectionHead
        eyebrow="The problem"
        title="Expired medicine does not vanish. It gets resold."
        lede="Once a batch passes its expiry date, the paperwork usually stops. Stock is written off on one system and quietly reappears on another shelf, under the same batch number, because nothing was counting. RCCP counts."
      />

      <ul className="mt-14 grid gap-px overflow-hidden rounded-panel border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        {STATS.map((s, i) => (
          <RevealLi key={s.label} delay={i * 70} className="bg-surface p-6">
              <p
                className={cn(
                  "font-display text-3xl font-bold tabular-nums",
                  i === 3 ? "text-clay-600" : "text-ink-900",
                )}
              >
                {s.value}
              </p>
              <p className="mt-1.5 text-sm font-medium text-ink-900">{s.label}</p>
              <p className="mt-1 text-[13px] leading-snug text-ink-500">{s.sub}</p>
          </RevealLi>
        ))}
      </ul>

      <Reveal delay={120}>
        <p className="mt-6 text-sm text-ink-500">
          Figures from the seeded demonstration batch, derived from the ledger — not typed in
          anywhere.
        </p>
      </Reveal>
    </Section>
  );
}

/* --------------------------------------------------------------------------- */

const CAPABILITIES = [
  {
    eyebrow: "Conservation",
    title: "Mass balance",
    summary:
      "More units of a batch cannot circulate than the manufacturer ever released.",
    rule: "I1 · MASS BALANCE",
    detail:
      "Every sale adds to a running total against the issued quantity. A reprinted batch number pushes that total past the ceiling on the very first scan it cannot account for.",
    catches: ["Cloned batch numbers", "Over-circulation of real stock"],
  },
  {
    eyebrow: "Existence",
    title: "Unknown is never clean",
    summary:
      "A batch number that resolves to nothing is treated as critical, not as missing data.",
    rule: "I2 · EXISTENCE",
    detail:
      "Batches are keyed by manufacturer AND batch number, because batch numbers collide between makers. Anything not resolving against that pair is blocked.",
    catches: ["Invented batch numbers", "One maker's recall hitting another's stock"],
    tone: "clay" as const,
  },
  {
    eyebrow: "Re-entry",
    title: "Destroyed stays destroyed",
    summary:
      "Once a batch is certified destroyed, anything bearing that number is counterfeit or diverted.",
    rule: "REGISTRY · RESURRECTED_BATCH",
    detail:
      "The certificate flips the batch's registry status permanently. A later scan anywhere in the network is refused with the destruction date attached.",
    catches: ["Resale of written-off stock", "Diversion after a disposal run"],
    tone: "clay" as const,
  },
  {
    eyebrow: "Custody",
    title: "Both sides of every handoff",
    summary:
      "Quantity cannot appear or vanish because stock changed hands.",
    rule: "I7 · LOCATION CONSERVATION",
    detail:
      "Each movement writes two ledger rows in one transaction: out of the sender, into the receiver. A location that ships more than reached it goes negative.",
    catches: ["Stock that leaves and never arrives", "Books that quietly stop balancing"],
  },
  {
    eyebrow: "Time",
    title: "The server's clock, always",
    summary:
      "A date supplied by a terminal is evidence. It is never an input to a verdict.",
    rule: "I5 · TEMPORAL VALIDITY",
    detail:
      "Expiry is checked against the server clock before any registry check — so a batch that quietly expired on a shelf and was never returned is still caught.",
    catches: ["Back-dated invoices", "Expired stock with a clean registry record"],
  },
  {
    eyebrow: "Silence",
    title: "The event that never happened",
    summary:
      "Stock accepted into the return pipeline and then never collected.",
    rule: "I8 · STAGE STALL",
    detail:
      "No rule is broken when nothing happens, which is exactly why it works. Each stage has a deadline; past it, the return is listed with the organisation that owes the next event.",
    catches: ["Returns quietly parked upstream", "Stock off the shelf but never destroyed"],
    tone: "clay" as const,
  },
  {
    eyebrow: "Shortfall",
    title: "Missing units stay missing",
    summary:
      "A shortfall at a handoff is recorded and left open. No approval closes it.",
    rule: "I6 · HANDOFF CONSERVATION",
    detail:
      "When fewer units arrive than were declared, the chain continues at the received quantity and the difference becomes an open leakage record. Nothing in the product can auto-resolve it.",
    catches: ["Quiet write-offs at a handoff", "Shortfalls absorbed by an approval"],
  },
  {
    eyebrow: "Proof",
    title: "A record that cannot be edited after",
    summary:
      "Every decision is appended to a hash chain that can be walked and verified.",
    rule: "AUDIT · SHA-256 CHAIN",
    detail:
      "Each entry carries the hash of the one before it. Altering any earlier row breaks every hash after it. It proves the record was not changed — not that destruction happened.",
    catches: ["Retrospective edits", "A tidied-up audit trail"],
  },
];

export function CapabilitiesSection() {
  return (
    <Section id="capabilities">
      <SectionHead
        eyebrow="Capabilities"
        title="Eight deterministic checks. No model, no scoring."
        lede="Every one of these is a pure function with a test behind it. Turn a card over to see the mechanism and the rule that enforces it."
      />

      <ul className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {CAPABILITIES.map((c, i) => (
          <RevealLi key={c.title} delay={Math.min(i, 4) * 60}>
            <FlipCard {...c} />
          </RevealLi>
        ))}
      </ul>

      <Reveal delay={80}>
        <p className="mt-8 text-sm text-ink-500">
          Tap or focus a card to turn it. Nothing here uses machine learning — a compliance
          finding a regulator cannot reproduce by hand is not a finding.
        </p>
      </Reveal>
    </Section>
  );
}

/* --------------------------------------------------------------------------- */

const STAGES = [
  {
    n: "01",
    title: "Issued and supplied",
    body: "A manufacturer registers a batch with a quantity ceiling. Every movement to a distributor or pharmacy writes both halves of the handoff.",
  },
  {
    n: "02",
    title: "Dispensed",
    body: "Each sale is checked against eight rules before it completes, and the patient gets a receipt whose QR resolves to the live record rather than a status frozen at the till.",
  },
  {
    n: "03",
    title: "Expired and returned",
    body: "At expiry, whatever was never sold becomes an obligation. The return travels retailer to distributor to manufacturer, and every shortfall along the way stays open.",
  },
  {
    n: "04",
    title: "Destroyed and certified",
    body: "A waste facility issues a certificate capped by the quantity actually confirmed along the chain. The batch is sealed, and any later scan of that number is refused.",
  },
];

export function ChainSection() {
  return (
    <Section id="chain" tone="ink">
      <SectionHead
        eyebrow="How it works"
        title="Shelf to certified destruction, in four stages"
        lede="The chain runs backwards from the point most systems stop caring: the moment stock stops being sellable."
        invert
      />

      <ol className="mt-14 grid gap-px overflow-hidden rounded-panel bg-white/10 md:grid-cols-2 xl:grid-cols-4">
        {STAGES.map((s, i) => (
          <RevealLi
            key={s.n}
            delay={i * 80}
            className="group bg-ink-900 p-7 transition-colors duration-300 hover:bg-[#191E27]"
          >
              <p className="font-mono text-xs font-medium text-pine-300">{s.n}</p>
              <h3 className="mt-4 font-display text-lg font-semibold text-white">{s.title}</h3>
              <p className="mt-2.5 text-sm leading-relaxed text-white/65">{s.body}</p>
          </RevealLi>
        ))}
      </ol>
    </Section>
  );
}

/* --------------------------------------------------------------------------- */

export function PublicSection() {
  return (
    <Section id="public">
      <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
        <div>
          <SectionHead
            eyebrow="For the public"
            title="Anyone can check a medicine. No account, ever."
            lede="A person holding a strip of tablets should not have to register to find out whether it is safe. The QR on a receipt opens straight to the live record — so a batch recalled after the sale turns that same printed receipt red, with nothing on the paper having changed."
          />
          <Reveal delay={100}>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/verify/MFG-TN-001/B-1001"
                className="inline-flex items-center rounded-md bg-ink-900 px-5 py-2.5 text-sm font-medium text-white shadow-card transition-all duration-200 ease-out hover:-translate-y-px hover:bg-pine-700 hover:shadow-lift active:translate-y-0"
              >
                Check a batch
              </Link>
              <Link
                href="/verify/bill/demo-recalled-bill-token-002"
                className="inline-flex items-center rounded-md border border-line-strong bg-surface px-5 py-2.5 text-sm font-medium text-ink-900 transition-all duration-200 ease-out hover:-translate-y-px hover:border-ink-400 hover:shadow-card active:translate-y-0"
              >
                Open a recalled receipt
              </Link>
            </div>
          </Reveal>
        </div>

        <Reveal delay={140}>
          <div className="rounded-panel border border-line bg-surface p-2 shadow-panel">
            <div className="rounded-[0.6rem] bg-sunken p-6">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500">
                Public result
              </p>
              <div className="mt-4 overflow-hidden rounded-card border-2 border-clay-500/40 bg-clay-50">
                <div className="h-1.5 w-full bg-clay-500" />
                <div className="p-5">
                  <p className="font-display text-xl font-bold text-clay-600">
                    RECALLED — DO NOT USE
                  </p>
                  <p className="mt-2 text-sm text-ink-700">
                    The regulator has recalled this batch.
                  </p>
                  <p className="mt-3 rounded bg-white/70 px-3 py-2 text-sm font-medium text-ink-900">
                    Stop taking it and return it to the pharmacy. If you feel unwell, speak to a
                    doctor.
                  </p>
                  <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-clay-500/20 pt-4 text-sm">
                    {[
                      ["Manufacturer", "Kelvin Labs"],
                      ["Batch", "RCL-4402"],
                      ["You bought", "14 units"],
                      ["Expires", "30/06/2028"],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <dt className="text-xs uppercase tracking-wide text-ink-500">{k}</dt>
                        <dd className="font-medium text-ink-900">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>
              <p className="mt-4 text-[13px] leading-snug text-ink-500">
                The receipt was issued before the recall. It has not been reprinted.
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}

/* --------------------------------------------------------------------------- */

const LIMITS = [
  {
    t: "A certificate is an attestation, not proof of destruction.",
    b: "Common biomedical waste facilities receive by weight and incinerate in bulk; they do not record batch numbers. What this enforces is a quantity ceiling against over-declaration.",
  },
  {
    t: "I1 does not detect a manufacturer under-declaring its own production.",
    b: "The issued quantity is manufacturer-declared. The invariant catches clones and over-circulation against that figure, not the figure itself.",
  },
  {
    t: "A negative balance is an inconsistency, not a diversion.",
    b: "A missed inbound record, a mis-keyed quantity and a genuine diversion look identical to I7. It is a reason to ask a question, never a finding.",
  },
  {
    t: "POS blocking binds only participating retailers.",
    b: "Enforcement that does not depend on the offender's cooperation sits in distributor invoicing, the public check, and the regulator's overdue list.",
  },
];

export function LimitsSection() {
  return (
    <Section id="limits" tone="sunken">
      <SectionHead
        eyebrow="Limits"
        title="What this does not do"
        lede="Stated here rather than waited for. A compliance tool that overclaims is worse than one that does less, because someone will rely on the claim."
      />

      <ul className="mt-12 grid gap-5 md:grid-cols-2">
        {LIMITS.map((l, i) => (
          <RevealLi
            key={l.t}
            delay={i * 70}
            className="rounded-card border border-line bg-surface p-6"
          >
            <p className="font-medium text-ink-900">{l.t}</p>
            <p className="mt-2 text-sm leading-relaxed text-ink-700">{l.b}</p>
          </RevealLi>
        ))}
      </ul>
    </Section>
  );
}
