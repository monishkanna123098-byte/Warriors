import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

const LANDING: Record<string, string> = {
  RETAILER: "/pos",
  DISTRIBUTOR: "/distributor",
  MANUFACTURER: "/manufacturer",
  FACILITY: "/facility",
  REGULATOR: "/regulator",
};

export default async function Home() {
  const session = await getSession();
  redirect(session ? (LANDING[session.role] ?? "/login") : "/login");
}
