import { requireUser } from "@/server/auth/require-user";
import { handler, ok } from "@/server/http/respond";
import { rateLimit } from "@/server/http/rate-limit";
import { getCourtScreen } from "@/server/services/court-service";

export const dynamic = "force-dynamic";

/** Court screen: characters, waiting events, positions (opens at most one new event per day). */
export const GET = handler(async () => {
  const { user, db } = await requireUser();
  rateLimit(`court:${user.id}`, 60, 60_000);
  return ok(await getCourtScreen(db, user.id));
});
