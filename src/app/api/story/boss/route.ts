import { requireUser } from "@/server/auth/require-user";
import { handler, ok, parseJson } from "@/server/http/respond";
import { rateLimit } from "@/server/http/rate-limit";
import { attackBoss } from "@/server/services/story-service";
import { storyBossSchema } from "@/server/validation";

export const dynamic = "force-dynamic";

/** Assault the chapter boss: the server rolls the battle; one attempt per day, idempotent. */
export const POST = handler(async (request: Request) => {
  const { user, db } = await requireUser();
  rateLimit(`story-boss:${user.id}`, 10, 60_000);
  const input = await parseJson(request, storyBossSchema);
  return ok(await attackBoss(db, user.id, input));
});
