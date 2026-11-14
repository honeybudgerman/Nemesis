import { requireUser } from "@/server/auth/require-user";
import { handler, ok, parseJson } from "@/server/http/respond";
import { rateLimit } from "@/server/http/rate-limit";
import { skipQuest } from "@/server/services/game-service";
import { skipQuestSchema } from "@/server/validation";

export const dynamic = "force-dynamic";

export const POST = handler(async (request: Request) => {
  const { user, db } = await requireUser();
  rateLimit(`skip:${user.id}`, 30, 60_000);
  const { questId } = await parseJson(request, skipQuestSchema);
  return ok(await skipQuest(db, user.id, questId));
});
