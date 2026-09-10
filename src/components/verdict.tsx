import { Card } from "./ui";

const TONES = {
  green: {
    frame: "border-emerald-300 bg-emerald-50",
    band: "bg-emerald-600",
    head: "text-emerald-900",
    label: "text-emerald-700",
  },
  red: {
    frame: "border-red-300 bg-red-50",
    band: "bg-red-600",
    head: "text-red-900",
    label: "text-red-700",
  },
  amber: {
    frame: "border-amber-300 bg-amber-50",
    band: "bg-amber-500",
    head: "text-amber-900",
    label: "text-amber-700",
  },
  slate: {
    frame: "border-slate-300 bg-slate-50",
    band: "bg-slate-500",
    head: "text-slate-900",
    label: "text-slate-600",
  },
} as const;

export type VerdictTone = keyof typeof TONES;

/**
 * The three questions someone seeing this system for the first time actually
 * has: what happened, why, and what do I do now.
 *
 * The rule that produced the verdict is shown but subordinate — a pharmacist
 * needs the action, and an auditor needs to be able to find the rule. Putting
 * "I5 TEMPORAL VALIDITY" where the instruction should be serves neither.
 */
export function Verdict({
  tone,
  headline,
  what,
  why,
  action,
  rule,
  children,
}: {
  tone: VerdictTone;
  headline: string;
  what?: string;
  why: string;
  action: string;
  rule?: string | null;
  children?: React.ReactNode;
}) {
  const t = TONES[tone];
  return (
    <Card className={`overflow-hidden border-2 p-0 ${t.frame}`}>
      <div className={`h-1.5 w-full ${t.band}`} />
      <div className="space-y-4 p-5">
        <div>
          <p className={`text-2xl font-bold tracking-tight ${t.head}`}>{headline}</p>
          {what ? <p className={`mt-0.5 text-sm font-semibold ${t.label}`}>{what}</p> : null}
        </div>

        <div className="space-y-3 text-sm">
          <div>
            <p className={`text-xs font-semibold uppercase tracking-wide ${t.label}`}>Why</p>
            <p className="mt-0.5 text-slate-800">{why}</p>
          </div>
          <div>
            <p className={`text-xs font-semibold uppercase tracking-wide ${t.label}`}>
              What happens next
            </p>
            <p className="mt-0.5 font-medium text-slate-900">{action}</p>
          </div>
        </div>

        {children}

        {rule ? (
          <p className="border-t border-black/10 pt-3 font-mono text-xs text-slate-500">
            Rule: {rule}
          </p>
        ) : null}
      </div>
    </Card>
  );
}

/** A single number with its label, for the accountability strips. */
export function Stat({
  label,
  value,
  tone = "slate",
  hint,
}: {
  label: string;
  value: number | string;
  tone?: "slate" | "red" | "green" | "amber";
  hint?: string;
}) {
  const colour =
    tone === "red"
      ? "text-red-700"
      : tone === "green"
        ? "text-emerald-700"
        : tone === "amber"
          ? "text-amber-700"
          : "text-slate-900";
  return (
    <div className="min-w-0">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-0.5 text-2xl font-bold tracking-tight tabular-nums ${colour}`}>{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}
