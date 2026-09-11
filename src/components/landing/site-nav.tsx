"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

const SECTIONS = [
  { id: "problem", label: "The problem" },
  { id: "capabilities", label: "Capabilities" },
  { id: "chain", label: "How it works" },
  { id: "public", label: "Public check" },
  { id: "limits", label: "Limits" },
];

/**
 * The site mark.
 *
 * Not a stock glyph in a circle beside a word. The three bars are the chain's
 * three legs — out, back, destroyed — with the last one struck through, which is
 * the whole product in one shape. It is drawn rather than imported so it takes
 * no request and inherits colour from its container.
 */
function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={className} aria-hidden="true" focusable="false">
      <rect x="2" y="5" width="24" height="3.2" rx="1.6" fill="currentColor" opacity="0.9" />
      <rect x="2" y="12.4" width="17" height="3.2" rx="1.6" fill="currentColor" opacity="0.55" />
      <rect x="2" y="19.8" width="10" height="3.2" rx="1.6" fill="currentColor" opacity="0.3" />
      <path
        d="M15.5 24.5 L26 15"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        opacity="0.9"
      />
    </svg>
  );
}

export function SiteNav({ dashboardHref }: { dashboardHref: string | null }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);

  // Scroll state for the bar's own background.
  //
  // passive: true tells the browser this listener will never preventDefault, so
  // it does not have to wait for it before scrolling. rAF-throttled so the state
  // write happens at most once a frame rather than once an event.
  useEffect(() => {
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        setScrolled(window.scrollY > 12);
        ticking = false;
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Which section is in view. An observer rather than measuring offsets against
  // scrollY on every frame.
  useEffect(() => {
    const els = SECTIONS.map((s) => document.getElementById(s.id)).filter(
      (e): e is HTMLElement => e !== null,
    );
    if (els.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActive(visible.target.id);
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: [0, 0.25, 0.5] },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);

  // An open drawer must not leave the page scrolling behind it, and Escape must
  // close it — both are things people try before looking for the × .
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-[background-color,border-color,box-shadow] duration-300",
        scrolled
          ? "border-b border-line bg-paper/85 shadow-[0_1px_0_rgba(20,24,31,0.04)] backdrop-blur-md supports-[backdrop-filter]:bg-paper/70"
          : "border-b border-transparent bg-transparent",
      )}
      style={{ height: "var(--nav-h)" }}
    >
      <div className="mx-auto flex h-full max-w-content items-center justify-between gap-3 px-4 sm:gap-6 sm:px-8">
        <Link href="/" className="flex min-w-0 items-center gap-2.5 text-pine-700">
          <Mark className="h-7 w-7 shrink-0" />
          <span className="flex flex-col leading-none">
            <span className="font-display text-[17px] font-bold tracking-tight text-ink-900">RCCP</span>
            <span className="mt-0.5 hidden whitespace-nowrap text-[10px] uppercase tracking-[0.14em] text-ink-500 sm:block">
              Reverse chain compliance
            </span>
          </span>
        </Link>

        <nav aria-label="Sections" className="hidden items-center gap-1 lg:flex">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              aria-current={active === s.id ? "true" : undefined}
              className={cn(
                "relative rounded-md px-3 py-2 text-sm transition-colors duration-200",
                active === s.id
                  ? "text-ink-900"
                  : "text-ink-500 hover:text-ink-900",
              )}
            >
              {s.label}
              <span
                aria-hidden="true"
                className={cn(
                  "absolute inset-x-3 -bottom-px h-px origin-left bg-pine-600 transition-transform duration-300 ease-out",
                  active === s.id ? "scale-x-100" : "scale-x-0",
                )}
              />
            </a>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <Link
            href="/verify/MFG-TN-001/B-1001"
            className="hidden whitespace-nowrap rounded-md px-3 py-2 text-sm text-ink-700 transition-colors duration-200 hover:text-pine-700 sm:inline-flex"
          >
            Check a medicine
          </Link>
          <Link
            href={dashboardHref ?? "/login"}
            className="inline-flex shrink-0 items-center whitespace-nowrap rounded-md bg-ink-900 px-3.5 py-2 text-sm font-medium text-white shadow-card transition-all duration-200 ease-out hover:-translate-y-px hover:bg-pine-700 hover:shadow-lift active:translate-y-0 active:shadow-card sm:px-4"
          >
            {dashboardHref ? "Dashboard" : "Sign in"}
          </Link>

          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls="site-menu"
            aria-label={open ? "Close menu" : "Open menu"}
            className="inline-flex h-10 w-10 items-center justify-center rounded-md text-ink-700 transition-colors hover:bg-sunken lg:hidden"
          >
            <span className="relative block h-3.5 w-5">
              <span
                className={cn(
                  "absolute left-0 block h-0.5 w-5 rounded bg-current transition-all duration-300",
                  open ? "top-1.5 rotate-45" : "top-0",
                )}
              />
              <span
                className={cn(
                  "absolute left-0 top-1.5 block h-0.5 w-5 rounded bg-current transition-opacity duration-200",
                  open && "opacity-0",
                )}
              />
              <span
                className={cn(
                  "absolute left-0 block h-0.5 w-5 rounded bg-current transition-all duration-300",
                  open ? "top-1.5 -rotate-45" : "top-3",
                )}
              />
            </span>
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      <div
        id="site-menu"
        hidden={!open}
        className="border-t border-line bg-paper/95 backdrop-blur-md lg:hidden"
      >
        <nav aria-label="Sections" className="mx-auto max-w-content px-5 py-3 sm:px-8">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              onClick={() => setOpen(false)}
              className="block rounded-md px-3 py-3 text-[15px] text-ink-700 transition-colors hover:bg-sunken"
            >
              {s.label}
            </a>
          ))}
          <a
            href="/verify/MFG-TN-001/B-1001"
            className="block rounded-md px-3 py-3 text-[15px] text-pine-700 transition-colors hover:bg-sunken"
          >
            Check a medicine
          </a>
        </nav>
      </div>
    </header>
  );
}
