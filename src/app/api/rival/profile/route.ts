import { requireUser } from "@/server/auth/require-user";
import { handler, ok } from "@/server/http/respond";
import { rateLimit } from "@/server/http/rate-limit";
import { getRivalView } from "@/server/services/rival-service";

export const dynamic = "force-dynamic";

/** Kael's full card: stats, skills, kingdom, recent chronicle and the comparison. */
export const GET = handler(async () => {
  const { user, db } = await requireUser();
  rateLimit(`rival:${user.id}`, 60, 60_000);
  return ok(await getRivalView(db, user.id));
});
