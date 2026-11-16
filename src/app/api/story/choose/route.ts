import { requireUser } from "@/server/auth/require-user";
import { handler, ok, parseJson } from "@/server/http/respond";
import { rateLimit } from "@/server/http/rate-limit";
import { decide } from "@/server/services/story-service";
import { storyChooseSchema } from "@/server/validation";

export const dynamic = "force-dynamic";

/** The chapter decision: atomic and idempotent (same idempotencyKey never applies twice). */
export const POST = handler(async (request: Request) => {
  const { user, db } = await requireUser();
  rateLimit(`story-choose:${user.id}`, 20, 60_000);
  const input = await parseJson(request, storyChooseSchema);
  return ok(await decide(db, user.id, input));
});
