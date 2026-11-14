import "server-only";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { publicEnv } from "@/lib/env";

/**
 * Request-scoped client acting as the signed-in user. Row Level Security
 * applies, so it can only read the user's own rows.
 */
export async function createUserSupabase(): Promise<SupabaseClient> {
  const { supabaseUrl, supabaseAnonKey } = publicEnv();
  const cookieStore = await cookies();
  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(toSet) {
        try {
          for (const { name, value, options } of toSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component: cookies are refreshed by middleware instead.
        }
      },
    },
  });
}
