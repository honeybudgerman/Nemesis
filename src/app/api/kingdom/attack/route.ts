import { requireUser } from "@/server/auth/require-user";
import { handler, ok, parseJson } from "@/server/http/respond";
import { rateLimit } from "@/server/http/rate-limit";
import { attack } from "@/server/services/realm-service";
import { attackSchema } from "@/server/validation";

export const dynamic = "force-dynamic";

/** Atomic and idempotent: the same idempotencyKey never applies twice. */
export const POST = handler(async (request: Request) => {
  const { user, db } = await requireUser();
  rateLimit(`kingdom-attack:${user.id}`, 10, 60_000);
  const input = await parseJson(request, attackSchema);
  return ok(await attack(db, user.id, input));
});
