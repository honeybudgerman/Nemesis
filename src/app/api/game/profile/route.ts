import { requireUser } from "@/server/auth/require-user";
import { handler, ok, parseJson } from "@/server/http/respond";
import { rateLimit } from "@/server/http/rate-limit";
import { deleteGame, getProfileSummary } from "@/server/services/game-service";
import { deleteGameSchema } from "@/server/validation";

export const dynamic = "force-dynamic";

export const GET = handler(async () => {
  const { user, db } = await requireUser();
  return ok(await getProfileSummary(db, user.id));
});

/** Delete the game profile and all related game data. Requires typed confirmation. */
export const DELETE = handler(async (request: Request) => {
  const { user } = await requireUser();
  rateLimit(`delete:${user.id}`, 3, 60_000);
  await parseJson(request, deleteGameSchema);
  return ok(await deleteGame(user.id));
});
