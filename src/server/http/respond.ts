import "server-only";
import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { ApiError } from "./errors";

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ data }, { ...init, headers: { "Cache-Control": "no-store", ...init?.headers } });
}

export function fail(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message, details: err.details } },
      { status: err.status, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (err instanceof ZodError) {
    return fail(new ApiError("VALIDATION_ERROR", undefined, err.issues.map((i) => ({ path: i.path, message: i.message }))));
  }
  // Log without request bodies/headers so secrets never reach the logs.
  console.error("[api] unexpected error:", err instanceof Error ? err.message : "unknown");
  return fail(new ApiError("INTERNAL"));
}

export async function parseJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ApiError("VALIDATION_ERROR", "Тело запроса должно быть JSON.");
  }
  return schema.parse(body);
}

/** Wrap a handler so any thrown error becomes a structured JSON response. */
export function handler<A extends unknown[]>(fn: (...args: A) => Promise<NextResponse>) {
  return async (...args: A): Promise<NextResponse> => {
    try {
      return await fn(...args);
    } catch (err) {
      return fail(err);
    }
  };
}
