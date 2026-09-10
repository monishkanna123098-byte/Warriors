import type { ApiErrorCode } from "./types";
import type { Severity } from "./types";

/**
 * Errors return { error: { code, message, detail } } where code is an AlertCode
 * (CLAUDE.md "Style"). Thrown by lifecycle.ts and the invariant guards; caught at
 * the route boundary and rendered by src/lib/http.ts.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly detail?: Record<string, unknown>,
    readonly severity?: Severity,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (code: ApiErrorCode, m: string, d?: Record<string, unknown>) =>
  new AppError(400, code, m, d);
export const unauthorized = (m = "Not authenticated") =>
  new AppError(401, "UNAUTHORIZED", m);
export const forbidden = (m = "Not permitted for this role or organisation") =>
  new AppError(403, "FORBIDDEN", m);
export const notFound = (m = "Not found", d?: Record<string, unknown>) =>
  new AppError(404, "NOT_FOUND", m, d);
export const conflict = (code: ApiErrorCode, m: string, d?: Record<string, unknown>) =>
  new AppError(409, code, m, d);
