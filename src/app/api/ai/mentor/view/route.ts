import { requireUser } from "@/server/auth/require-user";
import { handler, ok } from "@/server/http/respond";
import { rateLimit } from "@/server/http/rate-limit";
import { getMentorView } from "@/server/services/mentor-service";

export const dynamic = "force-dynamic";

/** Mentor screen: chat history, evaluations, AI limits and today's plan status. */
export const GET = handler(async () => {
  const { user, db } = await requireUser();
  rateLimit(`ai-view:${user.id}`, 60, 60_000);
  return ok(await getMentorView(db, user.id));
});
