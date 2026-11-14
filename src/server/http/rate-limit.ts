import "server-only";
import { ApiError } from "./errors";

/**
 * Simple fixed-window limiter, per server instance. Good enough as a first
 * line of defence for a single-user MVP; correctness (no double rewards) is
 * guaranteed by the database, not by this limiter.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 10_000) {
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    }
    return;
  }
  b.count++;
  if (b.count > limit) throw new ApiError("RATE_LIMITED");
}
