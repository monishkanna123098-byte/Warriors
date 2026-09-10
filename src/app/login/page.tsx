"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { post, ApiFailure } from "@/lib/client";
import { Button, Card, ErrorBanner, Field, Input } from "@/components/ui";

const DEMO_USERS = [
  ["reta@annanagar.example", "Anna Nagar Medicals — retailer"],
  ["retb@guindy.example", "Guindy Pharmacy — retailer"],
  ["retc@velachery.example", "Velachery Chemist — retailer"],
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
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-2xl font-bold tracking-tight">RCCP</h1>
      <p className="mt-1 text-sm text-slate-600">
        Pharma reverse chain compliance — retail shelf to verified destruction.
      </p>

      <Card className="mt-6 p-5">
        <form onSubmit={submit} className="space-y-4">
          <Field label="Sign in as">
            <select
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              {DEMO_USERS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Password">
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <ErrorBanner error={error} />
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </Card>

      <p className="mt-4 text-center text-xs text-slate-500">
        Seed password for every demo account is <code className="font-mono">demo1234</code>.
      </p>
    </div>
  );
}
