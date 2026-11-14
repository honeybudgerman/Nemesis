import { requireUser } from "@/server/auth/require-user";
import { handler, ok, parseJson } from "@/server/http/respond";
import { rateLimit } from "@/server/http/rate-limit";
import { createManualQuest } from "@/server/services/game-service";
import { createQuestSchema } from "@/server/validation";

export const dynamic = "force-dynamic";

/** Add a personal daily quest. XP is assigned by the server engine and capped per day. */
export const POST = handler(async (request: Request) => {
  const { user, db } = await requireUser();
  rateLimit(`create:${user.id}`, 10, 60_000);
  const input = await parseJson(request, createQuestSchema);
  return ok(await createManualQuest(db, user.id, input));
});
