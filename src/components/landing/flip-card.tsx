"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";

/**
 * An intel card that turns over to show what the capability actually catches.
 *
 * The front is the claim; the back is the mechanism and the rule that enforces
 * it. That split is the point — a judge or a regulator can skim eight claims,
 * then turn over the one they do not believe.
 *
 * Reachable three ways, which is not optional:
 *   - hover, for a mouse
 *   - focus, for a keyboard (the whole card is a button)
 *   - tap, via `is-flipped`, because a touch device has no hover at all and the
 *     back face would otherwise be unreachable on every phone
 *
 * The button carries aria-pressed and both faces stay in the accessibility tree,
 * so a screen reader gets the full content regardless of which side is showing.
 */
export function FlipCard({
  eyebrow,
  title,
  summary,
  rule,
  detail,
  catches,
  tone = "pine",
}: {
  eyebrow: string;
  title: string;
  summary: string;
  /** The invariant or mechanism, shown on the back. */
  rule: string;
  detail: string;
  /** Short list of what this actually stops. */
  catches: string[];
  tone?: "pine" | "clay";
}) {
  const [flipped, setFlipped] = useState(false);

  const accent =
    tone === "clay"
      ? { chip: "bg-clay-50 text-clay-600", bar: "bg-clay-500", rule: "text-clay-600" }
      : { chip: "bg-pine-50 text-pine-700", bar: "bg-pine-600", rule: "text-pine-700" };

  // The height is set for the LONGEST back face, not the front. A flip card
  // sized to its front clips its back, and a clipped explanation is worse than
  // no explanation — overflow-hidden on the faces makes any future overrun clip
  // cleanly inside the corner instead of spilling text onto the page.
  return (
    <div className="flip h-[22rem] sm:h-[20.5rem]">
      <button
        type="button"
        aria-pressed={flipped}
        onClick={() => setFlipped((f) => !f)}
        className="group block h-full w-full rounded-card text-left"
      >
        <div className={cn("flip-inner h-full w-full", flipped && "is-flipped")}>
          {/* ---- front ---- */}
          <div className="flip-face flex h-full flex-col overflow-hidden rounded-card border border-line bg-surface p-6 shadow-card transition-shadow duration-300 group-hover:shadow-lift">
            <span className={cn("h-1 w-10 rounded-full", accent.bar)} />
            <span
              className={cn(
                "mt-5 inline-flex w-fit rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider",
                accent.chip,
              )}
            >
              {eyebrow}
            </span>
            <h3 className="mt-3 font-display text-xl font-semibold text-ink-900">{title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-700">{summary}</p>
            <span className="mt-auto pt-4 text-xs font-medium text-ink-500">
              How it works
              <span aria-hidden="true" className="ml-1.5 inline-block transition-transform duration-300 group-hover:translate-x-0.5">
                →
              </span>
            </span>
          </div>

          {/* ---- back ---- */}
          <div className="flip-face flip-back flex h-full flex-col overflow-hidden rounded-card border border-pine-700 bg-pine-700 p-6 text-left shadow-lift">
            <p className={cn("font-mono text-[11px] font-medium uppercase tracking-wider text-pine-300")}>
              {rule}
            </p>
            <p className="mt-3 text-sm leading-relaxed text-pine-50">{detail}</p>
            <ul className="mt-4 space-y-1.5">
              {catches.map((c) => (
                <li key={c} className="flex gap-2 text-[13px] leading-snug text-pine-100">
                  <span aria-hidden="true" className="mt-[3px] text-pine-300">
                    ✓
                  </span>
                  {c}
                </li>
              ))}
            </ul>
            <span className="mt-auto pt-4 text-xs text-pine-300">
              <span aria-hidden="true" className="mr-1.5">
                ←
              </span>
              Back
            </span>
          </div>
        </div>
      </button>
    </div>
  );
}
