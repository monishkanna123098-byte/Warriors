// JWT in an httpOnly cookie. No auth provider beyond this (CLAUDE.md rule 10).

import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { prisma } from "./db";
import { forbidden, unauthorized } from "./errors";
import type { Role } from "./types";

export const SESSION_COOKIE = "rccp_session";
const ISSUER = "rccp";
const MAX_AGE_S = 60 * 60 * 12;

function secret(): Uint8Array {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) {
    throw new Error("JWT_SECRET is missing or shorter than 32 characters");
  }
  return new TextEncoder().encode(s);
}

export interface SessionClaims {
  userId: string;
  orgId: string;
  role: Role;
  email: string;
}

export async function signSession(claims: SessionClaims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_S}s`)
    .sign(secret());
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_S,
  };
}

async function claimsFromToken(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { issuer: ISSUER });
    const { userId, orgId, role, email } = payload as Partial<SessionClaims>;
    if (!userId || !orgId || !role || !email) return null;
    return { userId, orgId, role, email };
  } catch {
    return null;
  }
}

/** Returns null when there is no valid session. Never throws. */
export async function getSession(): Promise<SessionClaims | null> {
  // `cookies()` is synchronous in Next 14 and returns a Promise from Next 15 on.
  // Awaiting satisfies both: awaiting a non-thenable yields the value unchanged.
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return claimsFromToken(token);
}

/** Throws 401 when unauthenticated. */
export async function requireSession(): Promise<SessionClaims> {
  const s = await getSession();
  if (!s) throw unauthorized();
  return s;
}

/** Throws 401 when unauthenticated, 403 when the role is not permitted. */
export async function requireRole(...roles: Role[]): Promise<SessionClaims> {
  const s = await requireSession();
  if (!roles.includes(s.role)) {
    throw forbidden(`This endpoint requires role ${roles.join(" or ")}; you are ${s.role}`);
  }
  return s;
}

export async function currentUser() {
  const s = await getSession();
  if (!s) return null;
  return prisma.user.findUnique({
    where: { id: s.userId },
    include: { organization: true },
  });
}
