import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/require-user";
import { handler } from "@/server/http/respond";
import { rateLimit } from "@/server/http/rate-limit";
import { exportProgress } from "@/server/services/game-service";

export const dynamic = "force-dynamic";

/** Download all game progress as JSON. Contains no auth data or secrets. */
export const GET = handler(async () => {
  const { user, db } = await requireUser();
  rateLimit(`export:${user.id}`, 10, 60_000);
  const data = await exportProgress(db, user.id);
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="nemesis-${date}.json"`,
      "Cache-Control": "no-store",
    },
  });
});
