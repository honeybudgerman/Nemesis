import { requireUser } from "@/server/auth/require-user";
import { handler, ok, parseJson } from "@/server/http/respond";
import { rateLimit } from "@/server/http/rate-limit";
import { assign } from "@/server/services/court-service";
import { courtAssignSchema } from "@/server/validation";

export const dynamic = "force-dynamic";

/** Atomic and idempotent: the same idempotencyKey never applies twice. */
export const POST = handler(async (request: Request) => {
  const { user, db } = await requireUser();
  rateLimit(`court-assign:${user.id}`, 20, 60_000);
  const input = await parseJson(request, courtAssignSchema);
  return ok(await assign(db, user.id, input));
});
