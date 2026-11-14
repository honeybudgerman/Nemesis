import { requireUser } from "@/server/auth/require-user";
import { handler, ok, parseJson } from "@/server/http/respond";
import { rateLimit } from "@/server/http/rate-limit";
import { mentorChat } from "@/server/services/mentor-service";
import { mentorChatSchema } from "@/server/validation";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Talk to Orion. Falls back to prepared replies when the AI is unavailable or over limits. */
export const POST = handler(async (request: Request) => {
  const { user, db } = await requireUser();
  rateLimit(`ai-chat:${user.id}`, 10, 60_000);
  const { message } = await parseJson(request, mentorChatSchema);
  return ok(await mentorChat(db, user.id, message));
});
