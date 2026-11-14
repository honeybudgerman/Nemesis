import { requireUser } from "@/server/auth/require-user";
import { handler, ok, parseJson } from "@/server/http/respond";
import { rateLimit } from "@/server/http/rate-limit";
import { build } from "@/server/services/realm-service";
import { buildSchema } from "@/server/validation";

export const dynamic = "force-dynamic";

/** Atomic and idempotent: the same idempotencyKey never applies twice. */
export const POST = handler(async (request: Request) => {
  const { user, db } = await requireUser();
  rateLimit(`kingdom-build:${user.id}`, 20, 60_000);
  const input = await parseJson(request, buildSchema);
  return ok(await build(db, user.id, input));
});
