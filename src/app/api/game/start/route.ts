import { requireUser } from "@/server/auth/require-user";
import { handler, ok, parseJson } from "@/server/http/respond";
import { rateLimit } from "@/server/http/rate-limit";
import { getGameState, startGame } from "@/server/services/game-service";
import { startGameSchema } from "@/server/validation";

export const dynamic = "force-dynamic";

export const POST = handler(async (request: Request) => {
  const { user, db } = await requireUser();
  rateLimit(`start:${user.id}`, 5, 60_000);
  const input = await parseJson(request, startGameSchema);
  const result = await startGame(user.id, input);
  return ok({ created: result.created, state: await getGameState(db, user.id) });
});
