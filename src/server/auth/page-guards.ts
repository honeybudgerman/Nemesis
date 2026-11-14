import "server-only";
import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/env";
import { getProfileSummary } from "@/server/services/game-service";
import { createUserSupabase } from "@/server/supabase/server";

/** For game pages: signed in AND has a hero, otherwise redirect. */
export async function requireProfilePage() {
  if (!isSupabaseConfigured()) redirect("/");
  const db = await createUserSupabase();
  const { data } = await db.auth.getUser();
  if (!data.user) redirect("/login");
  const summary = await getProfileSummary(db, data.user.id);
  if (!summary.hasProfile) redirect("/start");
  return { user: data.user, profile: summary.profile };
}

/** For the character-creation page: signed in and has NO hero yet. */
export async function requireNoProfilePage() {
  if (!isSupabaseConfigured()) redirect("/");
  const db = await createUserSupabase();
  const { data } = await db.auth.getUser();
  if (!data.user) redirect("/login");
  const summary = await getProfileSummary(db, data.user.id);
  if (summary.hasProfile) redirect("/dashboard");
  return { user: data.user };
}
