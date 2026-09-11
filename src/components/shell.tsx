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

/**
 * Navigation, grouped.
 *
 * The regulator had thirteen flat links, which is past the point where a list
 * stops being scannable and becomes a wall — the eye has no anchors. Grouping by
 * what the person is trying to DO (act on stock, investigate, look something up)
 * costs nothing and makes the set navigable.
 */
interface NavGroup {
  label: string | null;
  items: { href: string; label: string }[];
}

const NAV: Record<string, NavGroup[]> = {
  RETAILER: [
    {
      label: null,
      items: [
        { href: "/pos", label: "POS terminal" },
        { href: "/sell", label: "Dispense + receipt" },
        { href: "/inventory", label: "Inventory" },
        { href: "/transfers", label: "Transfers" },
      ],
    },
    {
      label: "Returns",
      items: [
        { href: "/returns/due", label: "Returns due" },
        { href: "/returns", label: "My returns" },
        { href: "/receipts", label: "Compliance receipts" },
      ],
    },
  ],
  DISTRIBUTOR: [
    {
      label: null,
      items: [
        { href: "/distributor", label: "Inbound returns" },
        { href: "/transfers", label: "Transfers" },
        { href: "/distributor/leakage", label: "Leakage ledger" },
        { href: "/receipts", label: "Compliance receipts" },
      ],
    },
  ],
  MANUFACTURER: [
    {
      label: null,
      items: [
        { href: "/manufacturer", label: "Batch registry" },
        { href: "/transfers", label: "Transfers" },
      ],
    },
    {
      label: "Reverse chain",
      items: [
        { href: "/manufacturer/returns", label: "Inbound returns" },
        { href: "/manufacturer/certificates", label: "Certificates" },
        { href: "/manufacturer/alerts", label: "Alerts on my batches" },
        { href: "/receipts", label: "Compliance receipts" },
      ],
    },
  ],
  FACILITY: [{ label: null, items: [{ href: "/facility", label: "Inbound disposals" }] }],
  REGULATOR: [
    {
      label: null,
      items: [
        { href: "/regulator", label: "Overview" },
        { href: "/regulator/accountability", label: "Quantity accountability" },
      ],
    },
    {
      label: "Act",
      items: [
        { href: "/regulator/holds", label: "Holds + recalls" },
        { href: "/regulator/alerts", label: "Alerts" },
        { href: "/regulator/reports", label: "Public reports" },
      ],
    },
    {
      label: "Investigate",
      items: [
        { href: "/regulator/breaches", label: "Books not balancing" },
        { href: "/regulator/stalls", label: "Stalled returns" },
        { href: "/regulator/leakage", label: "Leakage by org" },
        { href: "/regulator/overdue", label: "Overdue returns" },
        { href: "/regulator/replay", label: "Forensic replay" },
      ],
    },
    {
      label: "Look up",
      items: [
        { href: "/regulator/batches", label: "Batch lookup" },
        { href: "/receipts", label: "Compliance receipts" },
        { href: "/regulator/cdsco", label: "CDSCO reference data" },
      ],
    },
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
    <div
      role="alert"
      className="fixed inset-x-4 bottom-4 z-50 animate-rise rounded-card bg-red-700 px-4 py-3.5 text-white shadow-panel sm:inset-x-auto sm:bottom-6 sm:right-6 sm:max-w-sm"
    >
      <div className="flex gap-3">
        <svg viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.7">
          <path d="M10 3.2 18 16.8H2z" strokeLinejoin="round" />
          <path d="M10 8.4v3.4" strokeLinecap="round" />
          <circle cx="10" cy="14.2" r="0.85" fill="currentColor" stroke="none" />
        </svg>
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wider text-red-100">Critical</p>
          <p className="mt-1 text-sm leading-snug">{message}</p>
        </div>
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-mr-1 -mt-1 ml-auto h-7 w-7 shrink-0 rounded text-red-100 transition-colors hover:bg-white/15 hover:text-white"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

/** The site mark, matched to the one on the landing page. */
function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={className} aria-hidden="true" focusable="false">
      <rect x="2" y="5" width="24" height="3.2" rx="1.6" fill="currentColor" opacity="0.9" />
      <rect x="2" y="12.4" width="17" height="3.2" rx="1.6" fill="currentColor" opacity="0.55" />
      <rect x="2" y="19.8" width="10" height="3.2" rx="1.6" fill="currentColor" opacity="0.3" />
      <path d="M15.5 24.5 L26 15" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" opacity="0.9" />
    </svg>
  );
}

function NavLinks({
  groups,
  pathname,
  onNavigate,
}: {
  groups: NavGroup[];
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <>
      {groups.map((group, gi) => (
        <div key={group.label ?? `g${gi}`} className={gi > 0 ? "mt-5" : undefined}>
          {group.label ? (
            <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400">
              {group.label}
            </p>
          ) : null}
          <div className="space-y-0.5">
            {group.items.map((n) => {
              const active =
                pathname === n.href || (n.href !== "/" && pathname.startsWith(`${n.href}/`));
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative block rounded-md py-2 pl-3 pr-3 text-sm transition-colors duration-150",
                    active
                      ? "bg-pine-50 font-medium text-pine-700"
                      : "text-ink-700 hover:bg-sunken hover:text-ink-900",
                  )}
                >
                  {/* A rail rather than a filled block: the active row stays
                      readable and the list keeps its rhythm. */}
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-pine-600 transition-opacity duration-150",
                      active ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {n.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    apiFetch<Me>("/api/me")
      .then(setMe)
      .catch(() => router.replace("/login"));
  }, [router]);

  // Close the drawer on navigation, and never leave the page scrolling behind it.
  useEffect(() => setMenuOpen(false), [pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const groups = me ? (NAV[me.organization.type] ?? []) : [];

  const brand = (
    <Link href="/" className="flex items-center gap-2.5 text-pine-700">
      <Mark className="h-6 w-6" />
      <span className="flex flex-col leading-none">
        <span className="font-display text-[15px] font-bold tracking-tight text-ink-900">RCCP</span>
        <span className="mt-0.5 text-[9px] uppercase tracking-[0.14em] text-ink-500">
          Reverse chain compliance
        </span>
      </span>
    </Link>
  );

  const publicLink = (
    <Link
      href="/verify/MFG-TN-001/B-1001"
      className="block rounded-md px-3 py-2 text-xs text-ink-500 transition-colors hover:bg-sunken hover:text-pine-700"
    >
      Public verify <span aria-hidden="true">→</span>
    </Link>
  );

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-line bg-surface md:flex">
        <div className="px-5 py-5">{brand}</div>
        <nav aria-label="Main" className="flex-1 px-3 pb-5">
          <NavLinks groups={groups} pathname={pathname} />
        </nav>
        <div className="border-t border-line px-3 py-3">{publicLink}</div>
      </aside>

      {/*
        Mobile drawer.

        The sidebar above is `hidden md:flex`, which used to mean a phone had NO
        navigation at all — every link in the product was unreachable below
        768px, and the only way to move between screens was the URL bar.
      */}
      {menuOpen ? (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div
            className="absolute inset-0 bg-ink-900/40 animate-fade"
            onClick={() => setMenuOpen(false)}
            role="presentation"
          />
          <div className="absolute inset-y-0 left-0 flex w-[17rem] max-w-[85vw] flex-col bg-surface shadow-panel animate-rise">
            <div className="flex items-center justify-between border-b border-line px-4 py-4">
              {brand}
              <button
                onClick={() => setMenuOpen(false)}
                aria-label="Close menu"
                className="flex h-9 w-9 items-center justify-center rounded-md text-ink-400 transition-colors hover:bg-sunken hover:text-ink-900"
              >
                <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            </div>
            <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-4">
              <NavLinks groups={groups} pathname={pathname} onNavigate={() => setMenuOpen(false)} />
            </nav>
            <div className="border-t border-line px-3 py-3">{publicLink}</div>
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-surface/90 px-4 py-3 backdrop-blur-md sm:px-6">
          <button
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
            aria-expanded={menuOpen}
            className="-ml-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-ink-700 transition-colors hover:bg-sunken md:hidden"
          >
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
              <path d="M3 6h14M3 10h14M3 14h14" />
            </svg>
          </button>

          <div className="min-w-0 flex-1">
            {me ? (
              <>
                <p className="truncate text-sm font-semibold text-ink-900">{me.organization.name}</p>
                <p className="truncate font-mono text-[11px] text-ink-500">
                  {me.organization.licenseNo} · {me.organization.district}
                </p>
              </>
            ) : (
              <>
                <div className="skeleton h-4 w-40" />
                <div className="skeleton mt-1.5 h-3 w-24" />
              </>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            {me ? (
              <Chip tone="green" className="hidden sm:inline-flex">
                {me.organization.type}
              </Chip>
            ) : null}
            <button
              onClick={async () => {
                await post("/api/auth/logout");
                router.replace("/login");
              }}
              className="rounded-md px-2.5 py-1.5 text-sm text-ink-500 transition-colors hover:bg-sunken hover:text-ink-900"
            >
              Sign out
            </button>
          </div>
        </header>

        <main id="main" className="flex-1 px-4 py-6 sm:px-6 sm:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
