"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch, post } from "@/lib/client";
import { cn } from "@/lib/cn";
import { Chip } from "@/components/ui";

interface Me {
  user: { id: string; email: string; role: string };
  organization: { id: string; name: string; type: string; licenseNo: string; district: string };
}

const NAV: Record<string, { href: string; label: string }[]> = {
  RETAILER: [
    { href: "/pos", label: "POS terminal" },
    { href: "/inventory", label: "Inventory" },
    { href: "/returns/due", label: "Returns due" },
    { href: "/returns", label: "My returns" },
    { href: "/receipts", label: "Compliance receipts" },
  ],
  DISTRIBUTOR: [
    { href: "/distributor", label: "Inbound returns" },
    { href: "/distributor/leakage", label: "Leakage ledger" },
    { href: "/receipts", label: "Compliance receipts" },
  ],
  MANUFACTURER: [
    { href: "/manufacturer", label: "Batch registry" },
    { href: "/manufacturer/returns", label: "Inbound returns" },
    { href: "/manufacturer/certificates", label: "Certificates" },
    { href: "/manufacturer/alerts", label: "Alerts on my batches" },
    { href: "/receipts", label: "Compliance receipts" },
  ],
  FACILITY: [{ href: "/facility", label: "Inbound disposals" }],
  REGULATOR: [
    { href: "/regulator", label: "Overview" },
    { href: "/regulator/alerts", label: "Alerts" },
    { href: "/regulator/leakage", label: "Leakage by org" },
    { href: "/regulator/overdue", label: "Overdue returns" },
    { href: "/regulator/batches", label: "Batch lookup" },
    { href: "/receipts", label: "Compliance receipts" },
    { href: "/regulator/cdsco", label: "CDSCO reference data" },
  ],
};

/** Toast on any CRITICAL (SPEC §6 shared). */
export function CriticalToast({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDismiss, 9000);
    return () => clearTimeout(t);
  }, [message, onDismiss]);

  if (!message) return null;
  return (
    <div className="fixed bottom-6 right-6 z-50 max-w-sm rounded-lg border border-red-300 bg-red-600 px-4 py-3 text-white shadow-lg">
      <p className="text-xs font-bold uppercase tracking-wider">Critical</p>
      <p className="mt-1 text-sm">{message}</p>
    </div>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    apiFetch<Me>("/api/me")
      .then(setMe)
      .catch(() => router.replace("/login"));
  }, [router]);

  const nav = me ? (NAV[me.organization.type] ?? []) : [];

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white md:block">
        <div className="px-5 py-5">
          <Link href="/" className="text-base font-bold tracking-tight">
            RCCP
          </Link>
          <p className="mt-0.5 text-xs text-slate-500">Reverse chain compliance</p>
        </div>
        <nav className="space-y-0.5 px-3 pb-5">
          {nav.map((n) => {
            const active = pathname === n.href || (n.href !== "/" && pathname.startsWith(`${n.href}/`));
            return (
              <Link
                key={n.href}
                href={n.href}
                className={cn(
                  "block rounded-md px-3 py-2 text-sm",
                  active ? "bg-slate-900 font-medium text-white" : "text-slate-700 hover:bg-slate-100",
                )}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto px-3 pb-5">
          <Link
            href="/verify/MFG-TN-001/B-1001"
            className="block rounded-md px-3 py-2 text-xs text-slate-500 hover:bg-slate-100"
          >
            Public verify →
          </Link>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{me?.organization.name ?? "…"}</p>
            <p className="truncate font-mono text-xs text-slate-500">
              {me?.organization.licenseNo ?? ""}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {me ? <Chip tone="blue">{me.organization.type}</Chip> : null}
            <button
              onClick={async () => {
                await post("/api/auth/logout");
                router.replace("/login");
              }}
              className="text-sm text-slate-500 hover:text-slate-900"
            >
              Sign out
            </button>
          </div>
        </header>
        <main className="flex-1 px-6 py-6">{children}</main>
      </div>
    </div>
  );
}
