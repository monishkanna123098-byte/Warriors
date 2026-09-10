"use client";

import { useCallback, useEffect, useState } from "react";

export interface ApiError {
  code: string;
  message: string;
  detail?: unknown;
}

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly error: ApiError,
  ) {
    super(error.message);
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new ApiFailure(res.status, body.error ?? { code: "CONFLICT", message: res.statusText });
  }
  return body as T;
}

export const post = <T,>(path: string, body?: unknown) =>
  apiFetch<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) });

/** Small polling-free data hook: fetch on mount, refetch on demand. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await apiFetch<T>(path));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiFailure ? e.error : { code: "CONFLICT", message: String(e) });
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, reload };
}
