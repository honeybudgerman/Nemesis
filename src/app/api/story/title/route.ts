import { requireUser } from "@/server/auth/require-user";
import { handler, ok, parseJson } from "@/server/http/respond";
import { rateLimit } from "@/server/http/rate-limit";
import { setTitle } from "@/server/services/story-service";
import { storyTitleSchema } from "@/server/validation";

export const dynamic = "force-dynamic";

/** Choose the active title (only unlocked ones). */
export const POST = handler(async (request: Request) => {
  const { user, db } = await requireUser();
  rateLimit(`story-title:${user.id}`, 20, 60_000);
  const input = await parseJson(request, storyTitleSchema);
  return ok(await setTitle(db, user.id, input));
});
