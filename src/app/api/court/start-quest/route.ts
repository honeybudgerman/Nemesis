import { z } from "zod";
import { requireUser } from "@/server/auth/require-user";
import { handler, ok, parseJson } from "@/server/http/respond";
import { rateLimit } from "@/server/http/rate-limit";
import { startPersonalQuest } from "@/server/services/court-service";

export const dynamic = "force-dynamic";

const schema = z.object({ code: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/) });

export const POST = handler(async (request: Request) => {
  const { user, db } = await requireUser();
  rateLimit(`court-start-quest:${user.id}`, 20, 60_000);
  const { code } = await parseJson(request, schema);
  return ok(await startPersonalQuest(db, user.id, code));
});
