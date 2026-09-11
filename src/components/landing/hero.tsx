"use client";

import Link from "next/link";
import { ChainCanvas } from "./chain-canvas";

/**
 * The first viewport has one job: say what this is and why it matters, before
 * anyone scrolls. The visual is the chain itself rather than an abstract
 * graphic, so the explanation starts before the copy does.
 */
export function Hero({ dashboardHref }: { dashboardHref: string | null }) {
  return (
    <section className="relative overflow-hidden px-5 pb-20 pt-[calc(var(--nav-h)+3rem)] sm:px-8 sm:pb-24 sm:pt-[calc(var(--nav-h)+4.5rem)]">
      {/* Decorative ground. Kept behind everything, low contrast, and masked out
          before it reaches the text — a background that competes with the
          headline is a background that failed. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-dots opacity-[0.5] mask-fade-b" />
        <div className="absolute -left-40 -top-40 h-[32rem] w-[32rem] rounded-full bg-pine-100/50 blur-3xl" />
        <div className="absolute -right-32 top-24 h-[26rem] w-[26rem] rounded-full bg-clay-50/70 blur-3xl" />
      </div>

      <div className="mx-auto grid max-w-content items-center gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
        <div className="animate-rise">
          <p className="inline-flex items-center gap-2 rounded-full border border-line bg-surface/80 px-3 py-1.5 text-[12px] font-medium text-ink-700 shadow-card backdrop-blur-sm">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-pine-500 opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-pine-600" />
            </span>
            Built for the CDSCO reverse-logistics guidance
          </p>

          <h1 className="mt-6 font-display text-display-lg font-bold text-ink-900">
            Expired medicine,{" "}
            <span className="relative whitespace-nowrap">
              <span className="relative z-10">accounted for</span>
              {/* A hand-drawn underline rather than a highlighter block: it
                  emphasises without changing the text's contrast. */}
              <svg
                aria-hidden="true"
                viewBox="0 0 300 12"
                preserveAspectRatio="none"
                className="absolute -bottom-0.5 left-0 h-2 w-full text-pine-300"
              >
                <path
                  d="M2 8.5C60 3.5 140 2.5 298 6"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  fill="none"
                />
              </svg>
            </span>{" "}
            down to the last unit.
          </h1>

          <p className="mt-6 max-w-prose text-[17px] leading-relaxed text-ink-700 sm:text-lg">
            RCCP tracks every batch from the retail shelf to verified destruction — and answers
            the question most systems cannot: of the units a manufacturer released, how many were
            sold, how many should have come back, and{" "}
            <span className="font-medium text-ink-900">which pharmacy still holds the rest</span>.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              href={dashboardHref ?? "/login"}
              className="inline-flex items-center rounded-md bg-ink-900 px-6 py-3 text-[15px] font-medium text-white shadow-card transition-all duration-200 ease-out hover:-translate-y-0.5 hover:bg-pine-700 hover:shadow-lift active:translate-y-0 active:shadow-card"
            >
              {dashboardHref ? "Open your dashboard" : "Sign in to the demo"}
            </Link>
            <Link
              href="/verify/MFG-TN-001/B-1001"
              className="inline-flex items-center rounded-md border border-line-strong bg-surface px-6 py-3 text-[15px] font-medium text-ink-900 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-ink-400 hover:shadow-card active:translate-y-0"
            >
              Check a medicine
              <span aria-hidden="true" className="ml-2 text-ink-400">
                →
              </span>
            </Link>
          </div>

          <p className="mt-5 text-[13px] text-ink-500">
            No account needed for the public check. Every demo login uses{" "}
            <code className="rounded bg-sunken px-1.5 py-0.5 font-mono text-[12px] text-ink-700">
              demo1234
            </code>
            .
          </p>
        </div>

        {/* The chain. Aspect-ratio rather than a fixed height so it never causes
            a layout shift while the canvas sizes itself. */}
        <div className="animate-rise [animation-delay:120ms]">
          <div className="relative rounded-panel border border-line bg-surface/70 p-3 shadow-panel backdrop-blur-sm">
            <div className="rounded-[0.7rem] bg-gradient-to-b from-pine-50/60 to-surface">
              <ChainCanvas className="block aspect-[4/3] w-full sm:aspect-[16/11]" />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-3 pb-1 pt-3">
              <span className="inline-flex items-center gap-2 text-[12px] text-ink-500">
                <span className="h-0.5 w-5 rounded bg-pine-600/60" />
                Stock out to the shelf
              </span>
              <span className="inline-flex items-center gap-2 text-[12px] text-ink-500">
                <span
                  className="h-0.5 w-5 rounded"
                  style={{
                    backgroundImage:
                      "repeating-linear-gradient(90deg,#B4552A 0 4px,transparent 4px 7px)",
                  }}
                />
                Expired stock coming back
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
