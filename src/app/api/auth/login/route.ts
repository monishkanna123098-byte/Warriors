import { z } from "zod";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/auth";
import { ok, parseBody, toResponse } from "@/lib/http";
import { AppError } from "@/lib/errors";
import type { Role } from "@/lib/types";

export const dynamic = "force-dynamic";

const Body = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function POST(req: Request) {
  try {
    const { email, password } = await parseBody(req, Body);
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: { organization: true },
    });

    // Same message and roughly the same work for both failure modes, so the
    // response does not disclose which addresses are registered.
    const hash = user?.passwordHash ?? "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidiu";
    const valid = await bcrypt.compare(password, hash);
    if (!user || !valid) throw new AppError(401, "UNAUTHORIZED", "Invalid email or password");

    const token = await signSession({
      userId: user.id,
      orgId: user.organizationId,
      role: user.role as Role,
      email: user.email,
    });
    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE, token, sessionCookieOptions());

    return ok({
      user: { id: user.id, email: user.email, role: user.role },
      organization: {
        id: user.organization.id,
        name: user.organization.name,
        type: user.organization.type,
        licenseNo: user.organization.licenseNo,
      },
    });
  } catch (e) {
    return toResponse(e);
  }
}
