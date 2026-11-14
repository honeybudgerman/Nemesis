import { requireUser } from "@/server/auth/require-user";
import { handler, ok, parseJson } from "@/server/http/respond";
import { rateLimit } from "@/server/http/rate-limit";
import { completeQuest } from "@/server/services/game-service";
import { completeQuestSchema } from "@/server/validation";

export const dynamic = "force-dynamic";

export const POST = handler(async (request: Request) => {
  const { user, db } = await requireUser();
  rateLimit(`complete:${user.id}`, 30, 60_000);
  const input = await parseJson(request, completeQuestSchema);
  return ok(await completeQuest(db, user.id, input));
});
