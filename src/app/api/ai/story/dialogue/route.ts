import { requireUser } from "@/server/auth/require-user";
import { handler, ok, parseJson } from "@/server/http/respond";
import { rateLimit } from "@/server/http/rate-limit";
import { chapterChronicle } from "@/server/services/story-service";
import { storyChronicleSchema } from "@/server/validation";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The chronicler retells a completed chapter. Written once (AI, or scripted
 * text when AI is unavailable or over limits) and stored; the AI changes nothing in the game.
 */
export const POST = handler(async (request: Request) => {
  const { user, db } = await requireUser();
  rateLimit(`ai-story:${user.id}`, 6, 60_000);
  return ok(await chapterChronicle(db, user.id, await parseJson(request, storyChronicleSchema)));
});
