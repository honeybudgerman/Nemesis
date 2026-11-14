import { requireUser } from "@/server/auth/require-user";
import { handler, ok, parseJson } from "@/server/http/respond";
import { rateLimit } from "@/server/http/rate-limit";
import { evaluateAnswer } from "@/server/services/mentor-service";
import { evaluateAnswerSchema } from "@/server/validation";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Orion grades a written answer; the server turns the grade into XP and
 * completes the quest once (same idempotency key as a normal completion).
 */
export const POST = handler(async (request: Request) => {
  const { user, db } = await requireUser();
  rateLimit(`ai-eval:${user.id}`, 10, 60_000);
  const input = await parseJson(request, evaluateAnswerSchema);
  return ok(await evaluateAnswer(db, user.id, input));
});
