"use client";

import type { ApiErrorBody } from "@/types/game";

export class ApiClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export const OFFLINE_MESSAGE = "Нет соединения. Прогресс можно смотреть, но действия станут доступны, когда интернет вернётся.";

export function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export async function apiFetch<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const method = init?.method ?? "GET";
  if (method !== "GET" && isOffline()) throw new ApiClientError("OFFLINE", OFFLINE_MESSAGE, 0);

  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      method,
      headers: { "Content-Type": "application/json", ...init?.headers },
      body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch {
    throw new ApiClientError("NETWORK", "Сервер недоступен. Проверьте соединение и попробуйте ещё раз.", 0);
  }

  const body = (await res.json().catch(() => null)) as ({ data: T } & Partial<ApiErrorBody>) | null;
  if (!res.ok || !body || body.error) {
    throw new ApiClientError(
      body?.error?.code ?? "HTTP_" + res.status,
      body?.error?.message ?? "Что-то пошло не так.",
      res.status,
    );
  }
  return body.data;
}

/** Random idempotency key; reused for retries of the same user action. */
export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}
