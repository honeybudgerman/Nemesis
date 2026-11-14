import { requireUser } from "@/server/auth/require-user";
import { handler, ok } from "@/server/http/respond";
import { rateLimit } from "@/server/http/rate-limit";
import { getKingdomScreen } from "@/server/services/realm-service";

export const dynamic = "force-dynamic";

export const GET = handler(async () => {
  const { user, db } = await requireUser();
  rateLimit(`kingdom:${user.id}`, 60, 60_000);
  const s = await getKingdomScreen(db, user.id);
  return ok({ territories: s.territories });
});
