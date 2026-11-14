import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";

let admin: SupabaseClient | null = null;

/**
 * Service-role client. Bypasses RLS and is the only role allowed to execute
 * the game's mutating SQL functions. Must never be imported by client code —
 * the "server-only" import above makes such an import fail the build.
 */
export function getAdminSupabase(): SupabaseClient {
  if (admin) return admin;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY не задан (см. .env.example)");
  admin = createClient(publicEnv().supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}
