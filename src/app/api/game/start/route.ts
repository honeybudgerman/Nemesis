import { requireUser } from "@/server/auth/require-user";
import { handler, ok, parseJson } from "@/server/http/respond";
import { rateLimit } from "@/server/http/rate-limit";
import { getGameState, startGame } from "@/server/services/game-service";
import { ensureRival } from "@/server/services/rival-service";
import { questPeriods } from "@/lib/time";
import { startGameSchema } from "@/server/validation";

export const dynamic = "force-dynamic";

export const POST = handler(async (request: Request) => {
  const { user, db } = await requireUser();
  rateLimit(`start:${user.id}`, 5, 60_000);
  const input = await parseJson(request, startGameSchema);
  const result = await startGame(user.id, input);
  // Kael appears together with the hero and starts living from today (ТЗ §7).
  await ensureRival(user.id, questPeriods(new Date(), input.timezone).today);
  return ok({ created: result.created, state: await getGameState(db, user.id) });
});
