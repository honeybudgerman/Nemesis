import { requireUser } from "@/server/auth/require-user";
import { ApiError, fromDbError } from "@/server/http/errors";
import { handler, ok } from "@/server/http/respond";
import { rateLimit } from "@/server/http/rate-limit";
import { syncRival } from "@/server/services/rival-service";

export const dynamic = "force-dynamic";

/**
 * Catch up Kael's missed days: a few 31-day batches per call. The client repeats
 * the call while `pendingDays > 0`, so a year of absence is ~4 short requests.
 */
export const POST = handler(async () => {
  const { user, db } = await requireUser();
  rateLimit(`rival-sync:${user.id}`, 30, 60_000);
  const p = await db
    .from("game_profiles")
    .select("id, users(timezone)")
    .eq("user_id", user.id)
    .maybeSingle<{ id: string; users: { timezone: string } | null }>();
  if (p.error) throw fromDbError(p.error);
  if (!p.data) throw new ApiError("PROFILE_NOT_FOUND");
  return ok(await syncRival(db, user.id, p.data.id, p.data.users?.timezone ?? "UTC"));
});
