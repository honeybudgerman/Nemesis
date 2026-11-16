import { requireUser } from "@/server/auth/require-user";
import { handler, ok, parseJson } from "@/server/http/respond";
import { rateLimit } from "@/server/http/rate-limit";
import { markSeen } from "@/server/services/story-service";
import { storySeenSchema } from "@/server/validation";

export const dynamic = "force-dynamic";

/** Mark the intro or outro scene as watched. */
export const POST = handler(async (request: Request) => {
  const { user, db } = await requireUser();
  rateLimit(`story-seen:${user.id}`, 30, 60_000);
  const input = await parseJson(request, storySeenSchema);
  return ok(await markSeen(db, user.id, input));
});
