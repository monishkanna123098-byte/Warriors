"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { post, ApiFailure } from "@/lib/client";
import { Button, Card, ErrorBanner, Field, Input, Select } from "@/components/ui";

const DEMO_USERS = [
  ["reta@annanagar.example", "Anna Nagar Medicals — retailer"],
  ["retb@guindy.example", "Guindy Pharmacy — retailer"],
  ["retc@velachery.example", "Velachery Chemist — retailer"],
  // The two pharmacies carrying the unaccounted stock in the AMX-25081 story.
  // They have to be reachable, or the demo can name them but never show them.
  ["retd@adyar.example", "Adyar Health Mart — retailer"],
  ["rete@tambaram.example", "Tambaram Medicals — retailer"],
  ["dist1@chennaimeds.example", "Chennai Meds — distributor"],
  ["mfg1@aurex.example", "Aurex Pharma — manufacturer"],
  ["mfg2@kelvin.example", "Kelvin Labs — manufacturer"],
  ["fac1@tnbiomedical.example", "TN Biomedical — facility"],
  ["reg1@tndrugscontrol.example", "TN Drugs Control — regulator"],
];

const LANDING: Record<string, string> = {
  RETAILER: "/pos",
  DISTRIBUTOR: "/distributor",
  MANUFACTURER: "/manufacturer",
  FACILITY: "/facility",
  REGULATOR: "/regulator",
};

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("reta@annanagar.example");
  const [password, setPassword] = useState("demo1234");
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await post<{ organization: { type: string } }>("/api/auth/login", { email, password });
      router.replace(LANDING[res.organization.type] ?? "/");
    } catch (err) {
      setError(err instanceof ApiFailure ? err.error : { code: "CONFLICT", message: String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-screen flex-col justify-center px-5 py-12 sm:px-6">
      {/* Same decorative ground as the landing hero, so signing in feels like
          part of the same product rather than a different application. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute inset-0 bg-dots opacity-[0.45]" />
        <div className="absolute -left-32 -top-32 h-[26rem] w-[26rem] rounded-full bg-pine-100/50 blur-3xl" />
        <div className="absolute -bottom-40 -right-24 h-[24rem] w-[24rem] rounded-full bg-clay-50/60 blur-3xl" />
      </div>

      <div className="mx-auto w-full max-w-[25rem] animate-rise">
        <Link href="/" className="inline-flex items-center gap-2.5 text-pine-700">
          <svg viewBox="0 0 28 28" className="h-7 w-7" aria-hidden="true" focusable="false">
            <rect x="2" y="5" width="24" height="3.2" rx="1.6" fill="currentColor" opacity="0.9" />
            <rect x="2" y="12.4" width="17" height="3.2" rx="1.6" fill="currentColor" opacity="0.55" />
            <rect x="2" y="19.8" width="10" height="3.2" rx="1.6" fill="currentColor" opacity="0.3" />
            <path d="M15.5 24.5 L26 15" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" opacity="0.9" />
          </svg>
          <span className="font-display text-xl font-bold tracking-tight text-ink-900">RCCP</span>
        </Link>

        <h1 className="mt-6 font-display text-display-sm font-semibold text-ink-900">
          Sign in to the demo
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-700">
          Six roles see the same events from their own side. Pick one — every account uses the
          same password.
        </p>

        <Card className="mt-7 p-6 shadow-panel">
          <form onSubmit={submit} className="space-y-4">
            <Field label="Sign in as">
              <Select value={email} onChange={(e) => setEmail(e.target.value)}>
                {DEMO_USERS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Password">
              <Input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <ErrorBanner error={error} />
            <Button type="submit" disabled={busy} className="w-full py-2.5">
              {busy ? (
                <>
                  <span
                    aria-hidden="true"
                    className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white"
                  />
                  Signing in…
                </>
              ) : (
                "Sign in"
              )}
            </Button>
          </form>
        </Card>

        <p className="mt-5 text-center text-[13px] text-ink-500">
          Password for every demo account is{" "}
          <code className="rounded bg-sunken px-1.5 py-0.5 font-mono text-[12px] text-ink-700">
            demo1234
          </code>
        </p>

        <div className="mt-8 rounded-card border border-line bg-surface/70 p-4 backdrop-blur-sm">
          <p className="text-[13px] leading-relaxed text-ink-700">
            Checking a medicine needs no account at all.{" "}
            <Link href="/verify/MFG-TN-001/B-1001" className="font-medium text-pine-700 underline underline-offset-2 hover:text-pine-600">
              Try the public check
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
