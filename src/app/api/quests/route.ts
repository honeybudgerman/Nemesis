import { requireUser } from "@/server/auth/require-user";
import { handler, ok } from "@/server/http/respond";
import { rateLimit } from "@/server/http/rate-limit";
import { getGameState } from "@/server/services/game-service";

export const dynamic = "force-dynamic";

export const GET = handler(async () => {
  const { user, db } = await requireUser();
  rateLimit(`quests:${user.id}`, 120, 60_000);
  const state = await getGameState(db, user.id);
  return ok({ quests: state.quests, periods: state.periods });
});
