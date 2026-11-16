import { requireUser } from "@/server/auth/require-user";
import { handler, ok, parseJson } from "@/server/http/respond";
import { rateLimit } from "@/server/http/rate-limit";
import { choose } from "@/server/services/court-service";
import { courtChooseSchema } from "@/server/validation";

export const dynamic = "force-dynamic";

/** Atomic and idempotent: the same idempotencyKey never applies twice. */
export const POST = handler(async (request: Request) => {
  const { user, db } = await requireUser();
  rateLimit(`court-choose:${user.id}`, 20, 60_000);
  const input = await parseJson(request, courtChooseSchema);
  return ok(await choose(db, user.id, input));
});
