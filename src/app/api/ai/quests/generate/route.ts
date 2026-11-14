import { requireUser } from "@/server/auth/require-user";
import { handler, ok } from "@/server/http/respond";
import { rateLimit } from "@/server/http/rate-limit";
import { generateDailyQuests } from "@/server/services/mentor-service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Orion plans today's quests (once per day, before any daily quest is closed). */
export const POST = handler(async () => {
  const { user, db } = await requireUser();
  rateLimit(`ai-gen:${user.id}`, 5, 60_000);
  return ok(await generateDailyQuests(db, user.id));
});
