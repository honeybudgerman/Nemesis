import { requireUser } from "@/server/auth/require-user";
import { handler, ok } from "@/server/http/respond";
import { rateLimit } from "@/server/http/rate-limit";
import { getGameState } from "@/server/services/game-service";

export const dynamic = "force-dynamic";

/**
 * Explicit sync: rolls the world forward to "now" (expires overdue quests,
 * issues new ones) and returns the authoritative state. Rival catch-up
 * simulation will hook in here in Sprint 2.
 */
export const POST = handler(async () => {
  const { user, db } = await requireUser();
  rateLimit(`sync:${user.id}`, 60, 60_000);
  return ok(await getGameState(db, user.id));
});
