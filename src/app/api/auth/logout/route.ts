import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth";
import { ok } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST() {
  cookies().delete(SESSION_COOKIE);
  return ok({ loggedOut: true });
}
