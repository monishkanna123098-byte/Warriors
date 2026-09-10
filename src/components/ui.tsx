"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import type { Severity } from "@/lib/types";

export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-lg border border-slate-200 bg-white shadow-sm", className)}
      {...p}
    />
  );
}

export function CardHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-3.5">
      <div>
        <h2 className="text-sm font-semibold tracking-tight text-slate-900">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p> : null}
      </div>
      {right}
    </div>
  );
}

const buttonStyles = {
  primary: "bg-slate-900 text-white hover:bg-slate-800 disabled:bg-slate-400",
  danger: "bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300",
  ghost: "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 disabled:text-slate-400",
} as const;

export function Button({
  variant = "primary",
  className,
  ...p
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof buttonStyles }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed",
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
        "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none placeholder:text-slate-400 focus:border-slate-900 focus:ring-1 focus:ring-slate-900",
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
        "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900",
        className,
      )}
      {...p}
    />
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-slate-500">{hint}</span> : null}
    </label>
  );
}

const chipTones = {
  grey: "bg-slate-100 text-slate-700 ring-slate-200",
  green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-red-50 text-red-800 ring-red-200",
  blue: "bg-blue-50 text-blue-800 ring-blue-200",
} as const;
export type ChipTone = keyof typeof chipTones;

export function Chip({ tone = "grey", children, className }: { tone?: ChipTone; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
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
};

export const severityTone: Record<Severity, ChipTone> = {
  LOW: "grey",
  MEDIUM: "blue",
  HIGH: "amber",
  CRITICAL: "red",
};

export function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
            {head.map((h) => (
              <th key={h} className="whitespace-nowrap px-5 py-2.5 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("whitespace-nowrap px-5 py-3 align-middle", className)} {...p} />;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-5 py-10 text-center text-sm text-slate-500">{children}</p>;
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
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-lg rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700" aria-label="Close">
            ✕
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export function ErrorBanner({ error }: { error: { code: string; message: string; detail?: unknown } | null }) {
  if (!error) return null;
  return (
    <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
      <p className="font-semibold">{error.code}</p>
      <p className="mt-0.5">{error.message}</p>
      {error.detail ? (
        <pre className="mt-2 overflow-x-auto rounded bg-red-100/60 p-2 text-xs">
          {JSON.stringify(error.detail, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}

/** A stacked proportion bar. Used for batch health and certificate allocation. */
export function StackedBar({ segments, total }: { segments: { label: string; value: number; className: string }[]; total: number }) {
  const denom = Math.max(total, segments.reduce((a, s) => a + s.value, 0), 1);
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
        {segments.map((s) =>
          s.value > 0 ? (
            <div
              key={s.label}
              className={s.className}
              style={{ width: `${(s.value / denom) * 100}%` }}
              title={`${s.label}: ${s.value}`}
            />
          ) : null,
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
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
