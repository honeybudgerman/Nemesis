import { requireUser } from "@/server/auth/require-user";
import { handler, ok, parseJson } from "@/server/http/respond";
import { rateLimit } from "@/server/http/rate-limit";
import { completeChapter } from "@/server/services/story-service";
import { storyCompleteSchema } from "@/server/validation";

export const dynamic = "force-dynamic";

/** Finish the chapter: the database re-checks every objective before granting rewards. */
export const POST = handler(async (request: Request) => {
  const { user, db } = await requireUser();
  rateLimit(`story-complete:${user.id}`, 10, 60_000);
  const input = await parseJson(request, storyCompleteSchema);
  return ok(await completeChapter(db, user.id, input));
});
