import { z } from "zod";
import { requireUser } from "@/server/auth/require-user";
import { ApiError } from "@/server/http/errors";
import { handler, ok } from "@/server/http/respond";
import { rateLimit } from "@/server/http/rate-limit";
import { getProfileSummary } from "@/server/services/game-service";
import { loadRivalActions } from "@/server/services/rival-service";

export const dynamic = "force-dynamic";

const query = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(40),
  before: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/** Paged chronicle of Kael's actions, newest day first (`before` = exclusive day cursor). */
export const GET = handler(async (request: Request) => {
  const { user, db } = await requireUser();
  rateLimit(`rival-actions:${user.id}`, 60, 60_000);
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = query.safeParse(params);
  if (!parsed.success) throw new ApiError("VALIDATION_ERROR", undefined, parsed.error.issues);
  const summary = await getProfileSummary(db, user.id);
  if (!summary.hasProfile) throw new ApiError("PROFILE_NOT_FOUND");
  const actions = await loadRivalActions(db, summary.profile.id, parsed.data.limit, parsed.data.before);
  return ok({ actions });
});
