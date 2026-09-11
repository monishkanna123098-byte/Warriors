"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import type { Severity } from "@/lib/types";

export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-card border border-line bg-surface shadow-card", className)}
      {...p}
    />
  );
}

/**
 * A card that responds to the pointer. Only for cards that actually DO
 * something — lifting a card that is not clickable is a promise the interface
 * does not keep.
 */
export function InteractiveCard({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-card border border-line bg-surface shadow-card transition-all duration-200 ease-out",
        "hover:-translate-y-0.5 hover:border-line-strong hover:shadow-lift",
        className,
      )}
      {...p}
    />
  );
}

export function CardHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-line px-5 py-4">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold tracking-tight text-ink-900">{title}</h2>
        {subtitle ? <p className="mt-1 text-[13px] leading-snug text-ink-500">{subtitle}</p> : null}
      </div>
      {right}
    </div>
  );
}

/**
 * Every variant moves on hover and settles on press. The press state matters
 * more than the hover one: on a touch screen it is the only feedback there is
 * that a tap registered.
 */
const buttonStyles = {
  primary:
    "bg-ink-900 text-white shadow-card hover:-translate-y-px hover:bg-pine-700 hover:shadow-lift active:translate-y-0 active:shadow-card disabled:bg-ink-400 disabled:shadow-none disabled:translate-y-0",
  danger:
    "bg-red-700 text-white shadow-card hover:-translate-y-px hover:bg-red-800 hover:shadow-lift active:translate-y-0 active:shadow-card disabled:bg-red-300 disabled:shadow-none disabled:translate-y-0",
  ghost:
    "bg-surface text-ink-700 border border-line-strong hover:-translate-y-px hover:border-ink-400 hover:text-ink-900 hover:shadow-card active:translate-y-0 active:shadow-none disabled:text-ink-400 disabled:border-line disabled:translate-y-0",
  quiet:
    "bg-transparent text-ink-500 hover:bg-sunken hover:text-ink-900 disabled:text-ink-400",
} as const;

export function Button({
  variant = "primary",
  className,
  ...p
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof buttonStyles }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium",
        "transition-all duration-200 ease-out disabled:cursor-not-allowed",
        // Never let a label wrap mid-word into a two-line button.
        "whitespace-nowrap",
        buttonStyles[variant],
        className,
      )}
      {...p}
    />
  );
}

export function Input({ className, ...p }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "w-full rounded-md border border-line-strong bg-surface px-3 py-2.5 text-sm text-ink-900 outline-none transition-colors duration-150",
        "placeholder:text-ink-400 hover:border-ink-400",
        "focus:border-pine-600 focus:ring-2 focus:ring-pine-600/25",
        // A field that is wrong should look wrong before it is submitted.
        "aria-[invalid=true]:border-red-500 aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-red-500/20",
        "disabled:bg-sunken disabled:text-ink-400",
        className,
      )}
      {...p}
    />
  );
}

export function Select({ className, ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "w-full appearance-none rounded-md border border-line-strong bg-surface px-3 py-2.5 pr-9 text-sm text-ink-900 outline-none transition-colors duration-150",
        "hover:border-ink-400 focus:border-pine-600 focus:ring-2 focus:ring-pine-600/25 disabled:bg-sunken disabled:text-ink-400",
        // Custom chevron so the control matches Input across browsers.
        "bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22 fill=%22none%22 stroke=%22%23697588%22 stroke-width=%221.6%22 stroke-linecap=%22round%22%3E%3Cpath d=%22M4 6.5 8 10.5 12 6.5%22/%3E%3C/svg%3E')] bg-[length:16px] bg-[right_0.7rem_center] bg-no-repeat",
        className,
      )}
      {...p}
    />
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-ink-700">{label}</span>
      {children}
      {hint ? <span className="mt-1.5 block text-xs leading-snug text-ink-500">{hint}</span> : null}
    </label>
  );
}

const chipTones = {
  grey: "bg-sunken text-ink-700 ring-line-strong",
  green: "bg-pine-50 text-pine-700 ring-pine-100",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-red-50 text-red-800 ring-red-200",
  blue: "bg-slate-100 text-slate-700 ring-slate-200",
} as const;
export type ChipTone = keyof typeof chipTones;

export function Chip({ tone = "grey", children, className }: { tone?: ChipTone; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        chipTones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export const expiryTone: Record<string, ChipTone> = {
  NORMAL: "grey",
  EXPIRY_WARNING: "amber",
  RETURN_DUE: "red",
};

export const registryTone: Record<string, ChipTone> = {
  CLEAN: "green",
  IN_RETURN_PIPELINE: "amber",
  DESTROYED: "red",
  HELD: "amber",
  RECALLED: "red",
};

export const severityTone: Record<Severity, ChipTone> = {
  LOW: "grey",
  MEDIUM: "blue",
  HIGH: "amber",
  CRITICAL: "red",
};

export function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    // max-w-full matters as much as overflow-x-auto: a wide table inside a flex
    // or grid child will stretch the CONTAINER unless the scroll box is capped,
    // and then the whole page scrolls sideways instead of just the table.
    <div className="w-full max-w-full overflow-x-auto">
      <table className="w-full min-w-full text-sm">
        <thead>
          <tr className="border-b border-line bg-sunken/60 text-left text-[11px] uppercase tracking-wider text-ink-500">
            {head.map((h) => (
              <th key={h} scope="col" className="whitespace-nowrap px-5 py-3 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line/70 [&>tr]:transition-colors [&>tr:hover]:bg-sunken/50">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("whitespace-nowrap px-5 py-3 align-middle", className)} {...p} />;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-5 py-14 text-center">
      <div
        aria-hidden="true"
        className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-sunken text-ink-400"
      >
        <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="4.5" width="14" height="11" rx="2" />
          <path d="M3 8.5h14" strokeLinecap="round" />
        </svg>
      </div>
      <p className="mt-3 text-sm text-ink-500">{children}</p>
    </div>
  );
}

/** Placeholder rows while a table loads, sized like the content they replace. */
export function TableSkeleton({ rows = 4, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-3 px-5 py-5" aria-hidden="true">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4">
          {Array.from({ length: cols }).map((_, c) => (
            <div key={c} className="skeleton h-4 flex-1" style={{ maxWidth: c === 0 ? "none" : "8rem" }} />
          ))}
        </div>
      ))}
      <span className="sr-only">Loading</span>
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  // Escape closes it, and the page behind must not scroll while it is open.
  // Both are the first things a user tries before hunting for the ×.
  React.useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/45 p-0 backdrop-blur-[2px] animate-fade sm:items-center sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      {/* Full-width sheet on a phone, centred dialog above it — a 512px box
          floating in the middle of a 375px screen is a desktop modal shrunk. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-t-panel bg-surface shadow-panel animate-rise sm:rounded-panel"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h3 className="text-[15px] font-semibold text-ink-900">{title}</h3>
          <button
            onClick={onClose}
            className="-mr-1.5 flex h-8 w-8 items-center justify-center rounded-md text-ink-400 transition-colors hover:bg-sunken hover:text-ink-900"
            aria-label="Close"
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
        <div className="px-5 py-5">{children}</div>
      </div>
    </div>
  );
}

export function ErrorBanner({ error }: { error: { code: string; message: string; detail?: unknown } | null }) {
  if (!error) return null;
  return (
    // role=alert so a screen reader announces it the moment it appears, rather
    // than only when the user happens to tab back over the form.
    <div
      role="alert"
      className="overflow-hidden rounded-card border border-red-200 bg-red-50 text-sm text-red-900 animate-fade"
    >
      <div className="flex gap-3 px-4 py-3">
        <svg viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0 text-red-600" fill="none" stroke="currentColor" strokeWidth="1.6">
          <circle cx="10" cy="10" r="7.5" />
          <path d="M10 6.5v4.5" strokeLinecap="round" />
          <circle cx="10" cy="13.6" r="0.9" fill="currentColor" stroke="none" />
        </svg>
        <div className="min-w-0">
          <p className="font-semibold leading-snug">{error.message}</p>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-wider text-red-700/80">
            {error.code}
          </p>
          {error.detail ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-red-700 hover:text-red-900">
                Technical detail
              </summary>
              <pre className="mt-1.5 overflow-x-auto rounded bg-red-100/70 p-2 text-[11px] leading-relaxed">
                {JSON.stringify(error.detail, null, 2)}
              </pre>
            </details>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Confirmation, in the same shape as ErrorBanner so a form can swap between them. */
export function SuccessBanner({ message, children }: { message: string; children?: React.ReactNode }) {
  return (
    <div
      role="status"
      className="flex gap-3 rounded-card border border-pine-100 bg-pine-50 px-4 py-3 text-sm text-pine-900 animate-fade"
    >
      <svg viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0 text-pine-600" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="10" cy="10" r="7.5" strokeWidth="1.6" />
        <path d="M6.6 10.2 9 12.5l4.4-4.8" />
      </svg>
      <div className="min-w-0">
        <p className="font-medium leading-snug">{message}</p>
        {children}
      </div>
    </div>
  );
}

/** A stacked proportion bar. Used for batch health and certificate allocation. */
export function StackedBar({ segments, total }: { segments: { label: string; value: number; className: string }[]; total: number }) {
  const denom = Math.max(total, segments.reduce((a, s) => a + s.value, 0), 1);
  return (
    <div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-sunken ring-1 ring-inset ring-line">
        {segments.map((s) =>
          s.value > 0 ? (
            <div
              key={s.label}
              className={cn(s.className, "transition-[width] duration-700 ease-out")}
              style={{ width: `${(s.value / denom) * 100}%` }}
              title={`${s.label}: ${s.value}`}
            />
          ) : null,
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-700">
        {segments.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <span className={cn("h-2 w-2 rounded-sm", s.className)} />
            {s.label} {s.value}
          </span>
        ))}
      </div>
    </div>
  );
}
