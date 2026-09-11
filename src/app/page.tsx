import Link from "next/link";
import { getSession } from "@/lib/auth";
import { SiteNav } from "@/components/landing/site-nav";
import { Hero } from "@/components/landing/hero";
import {
  CapabilitiesSection,
  ChainSection,
  LimitsSection,
  ProblemSection,
  PublicSection,
} from "@/components/landing/sections";

export const dynamic = "force-dynamic";

/**
 * Where each role lands. Unchanged from the redirect this page used to perform —
 * a signed-in user still reaches their own dashboard in one click, they simply
 * get the explanation first rather than being bounced past it.
 */
const LANDING: Record<string, string> = {
  RETAILER: "/pos",
  DISTRIBUTOR: "/distributor",
  MANUFACTURER: "/manufacturer",
  FACILITY: "/facility",
  REGULATOR: "/regulator",
};

export default async function Home() {
  const session = await getSession();
  const dashboardHref = session ? (LANDING[session.role] ?? "/login") : null;

  return (
    <>
      <SiteNav dashboardHref={dashboardHref} />

      <main id="main">
        <Hero dashboardHref={dashboardHref} />
        <ProblemSection />
        <CapabilitiesSection />
        <ChainSection />
        <PublicSection />
        <LimitsSection />

        {/* Closing call to action */}
        <section className="px-5 py-20 sm:px-8 sm:py-24">
          <div className="mx-auto max-w-content">
            <div className="relative overflow-hidden rounded-panel border border-line bg-surface px-6 py-14 text-center shadow-panel sm:px-12">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 -z-10 bg-dots opacity-40"
              />
              <h2 className="mx-auto max-w-2xl font-display text-display-sm font-semibold text-ink-900">
                Six roles, one ledger, and a public check anyone can run.
              </h2>
              <p className="mx-auto mt-4 max-w-prose text-[17px] leading-relaxed text-ink-700">
                Sign in as a pharmacy, a distributor, a manufacturer, a waste facility or the drugs
                controller — each sees the same events from their own side.
              </p>
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <Link
                  href={dashboardHref ?? "/login"}
                  className="inline-flex items-center rounded-md bg-ink-900 px-6 py-3 text-[15px] font-medium text-white shadow-card transition-all duration-200 ease-out hover:-translate-y-0.5 hover:bg-pine-700 hover:shadow-lift active:translate-y-0"
                >
                  {dashboardHref ? "Open your dashboard" : "Sign in to the demo"}
                </Link>
                <Link
                  href="/verify/bill/demo-valid-bill-token-0001"
                  className="inline-flex items-center rounded-md border border-line-strong bg-surface px-6 py-3 text-[15px] font-medium text-ink-900 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-ink-400 hover:shadow-card active:translate-y-0"
                >
                  See a consumer receipt
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line bg-sunken px-5 py-10 sm:px-8">
        <div className="mx-auto flex max-w-content flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-display text-base font-bold text-ink-900">RCCP</p>
            <p className="mt-0.5 text-[13px] text-ink-500">
              Pharma reverse chain compliance · demonstration build with synthetic data
            </p>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-[13px]">
            <Link href="/login" className="text-ink-700 transition-colors hover:text-pine-700">
              Sign in
            </Link>
            <Link
              href="/verify/MFG-TN-001/B-1001"
              className="text-ink-700 transition-colors hover:text-pine-700"
            >
              Public verify
            </Link>
            <a href="#limits" className="text-ink-700 transition-colors hover:text-pine-700">
              Known limits
            </a>
          </nav>
        </div>
      </footer>
    </>
  );
}
