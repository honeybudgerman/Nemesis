import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { isSupabaseConfigured } from "@/lib/env";
import { ApiError } from "@/server/http/errors";
import { createUserSupabase } from "@/server/supabase/server";

export interface AuthContext {
  user: User;
  /** RLS-scoped client for reads. */
  db: SupabaseClient;
}

/** Verifies the session with Supabase Auth (not just the cookie) on every call. */
export async function requireUser(): Promise<AuthContext> {
  if (!isSupabaseConfigured()) throw new ApiError("NOT_CONFIGURED");
  const db = await createUserSupabase();
  const { data, error } = await db.auth.getUser();
  if (error || !data.user) throw new ApiError("UNAUTHORIZED");
  return { user: data.user, db };
}
