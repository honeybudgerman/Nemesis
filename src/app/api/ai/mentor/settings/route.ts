import { requireUser } from "@/server/auth/require-user";
import { ApiError } from "@/server/http/errors";
import { handler, ok, parseJson } from "@/server/http/respond";
import { rateLimit } from "@/server/http/rate-limit";
import { getProfileSummary } from "@/server/services/game-service";
import { getAiStatus, updateAiSettings } from "@/server/services/mentor-service";
import { aiSettingsSchema } from "@/server/validation";

export const dynamic = "force-dynamic";

async function status(db: Parameters<typeof getAiStatus>[0], userId: string) {
  const p = await getProfileSummary(db, userId);
  if (!p.hasProfile) throw new ApiError("PROFILE_NOT_FOUND");
  return getAiStatus(db, userId, p.profile.id);
}

export const GET = handler(async () => {
  const { user, db } = await requireUser();
  rateLimit(`ai-settings:${user.id}`, 60, 60_000);
  return ok(await status(db, user.id));
});

/** Manual AI limits (ТЗ §9.4): requests per day and monthly budget in USD. */
export const PUT = handler(async (request: Request) => {
  const { user, db } = await requireUser();
  rateLimit(`ai-settings:${user.id}`, 20, 60_000);
  const input = await parseJson(request, aiSettingsSchema);
  await updateAiSettings(user.id, input);
  return ok(await status(db, user.id));
});
