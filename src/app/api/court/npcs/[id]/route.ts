import { z } from "zod";
import { requireUser } from "@/server/auth/require-user";
import { ApiError } from "@/server/http/errors";
import { handler, ok } from "@/server/http/respond";
import { rateLimit } from "@/server/http/rate-limit";
import { getNpcDetail } from "@/server/services/court-service";

export const dynamic = "force-dynamic";

const idSchema = z.string().regex(/^[a-z_]{2,40}$/);

/** One character: biography, relationships, personal quest, recent dialogue, today's actions. */
export const GET = handler(async (_request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { user, db } = await requireUser();
  rateLimit(`court-npc:${user.id}`, 90, 60_000);
  const { id } = await ctx.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw new ApiError("VALIDATION_ERROR");
  return ok(await getNpcDetail(db, user.id, parsed.data));
});
