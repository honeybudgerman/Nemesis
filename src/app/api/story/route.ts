import { requireUser } from "@/server/auth/require-user";
import { handler, ok } from "@/server/http/respond";
import { rateLimit } from "@/server/http/rate-limit";
import { getStoryScreen } from "@/server/services/story-service";

export const dynamic = "force-dynamic";

/** Chronicles screen: current chapter, achievements, titles, items, history. */
export const GET = handler(async () => {
  const { user, db } = await requireUser();
  rateLimit(`story:${user.id}`, 60, 60_000);
  return ok(await getStoryScreen(db, user.id));
});
