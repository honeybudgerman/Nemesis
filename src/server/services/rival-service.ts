import "server-only";
import { randomInt } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { STARTING_RESOURCES } from "@/data/kingdom";
import {
  KAEL,
  KAEL_STARTING_STATS,
  SIMULATION_BATCH_DAYS,
  SIMULATION_MAX_BATCHES_PER_REQUEST,
  SIMULATION_VERSION,
} from "@/data/rival/kael";
import { SKILL_CODES } from "@/data/skills";
import { levelProgress } from "@/engine/progression/xp";
import { countPendingDays, simulateBatch } from "@/engine/simulation/rival";
import { buildApplyPayload, rivalStateFromRows, type RivalProfileRow } from "@/engine/simulation/rival-persistence";
import { questPeriods } from "@/lib/time";
import { ApiError, fromDbError } from "@/server/http/errors";
import { getAdminSupabase } from "@/server/supabase/admin";
import type { HeroStats, RivalActionView, RivalSummary, RivalView } from "@/types/game";

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getAdminSupabase().rpc(fn, args);
  if (error) throw fromDbError(error);
  return data as T;
}

/** Create Kael for this profile if he doesn't exist yet (also backfills profiles from Sprint 1). */
export async function ensureRival(userId: string, today: string) {
  return rpc<{ rival_id: string; created: boolean }>("ensure_rival", {
    p_user_id: userId,
    p_name: KAEL.name,
    p_kingdom_name: KAEL.kingdomName,
    p_params: {
      discipline: KAEL.disciplineFactor,
      learning: KAEL.learningFactor,
      risk: KAEL.riskTolerance,
      dailyMinutes: KAEL.dailyMinutes,
    },
    p_rng_seed: randomInt(1, 2 ** 31 - 1),
    p_version: SIMULATION_VERSION,
    p_start_day: today,
    p_skill_codes: [...SKILL_CODES],
    p_stats: KAEL_STARTING_STATS,
    p_resources: STARTING_RESOURCES,
  });
}

const RIVAL_COLUMNS =
  "id, name, discipline_factor, learning_factor, risk_tolerance, daily_minutes, level, total_xp, fatigue, last_simulated_day, simulation_version, rng_seed";

async function loadRivalState(db: SupabaseClient, profileId: string) {
  const [r, skills, kingdom] = await Promise.all([
    db.from("rival_profiles").select(RIVAL_COLUMNS).eq("game_profile_id", profileId).maybeSingle<RivalProfileRow>(),
    db.from("skills").select("skill_code, xp").eq("game_profile_id", profileId).eq("character_type", "RIVAL"),
    db.from("kingdoms").select("gold").eq("game_profile_id", profileId).eq("owner_type", "RIVAL").maybeSingle(),
  ]);
  for (const x of [r, skills, kingdom]) if (x.error) throw fromDbError(x.error);
  if (!r.data) return null;
  return {
    row: r.data,
    state: rivalStateFromRows(r.data, skills.data ?? [], kingdom.data?.gold ?? 0),
  };
}

/**
 * Catch up Kael's missed days in bounded batches (ТЗ §7.6): each batch is one
 * transaction with a checkpoint; at most `maxBatches` per call so a long absence
 * never turns into one unbounded request. Returns how many days are still pending.
 */
export async function syncRival(
  db: SupabaseClient,
  userId: string,
  profileId: string,
  timezone: string,
  maxBatches = SIMULATION_MAX_BATCHES_PER_REQUEST,
): Promise<{ simulatedDays: number; pendingDays: number }> {
  const today = questPeriods(new Date(), timezone).today;
  const load = async () => {
    const loaded = await loadRivalState(db, profileId);
    if (!loaded) throw new ApiError("RIVAL_NOT_FOUND");
    return loaded;
  };
  // Profiles created before Sprint 2 get Kael on first load; the call is idempotent.
  if (!(await loadRivalState(db, profileId))) await ensureRival(userId, today);

  let simulated = 0;
  for (let i = 0; i < maxBatches; i++) {
    const { row, state } = await load();
    if (state.version !== SIMULATION_VERSION) break; // never replay old days under new rules
    const batch = simulateBatch(state, row.last_simulated_day, today, SIMULATION_BATCH_DAYS);
    if (batch.days.length === 0) return { simulatedDays: simulated, pendingDays: 0 };

    const res = await rpc<{ status: string }>("apply_rival_days", {
      p_user_id: userId,
      p_expected_last_day: row.last_simulated_day,
      p_payload: buildApplyPayload(batch.days, batch.state),
    });
    if (res.status === "applied") simulated += batch.days.length;
    // "stale": a concurrent request advanced the state; the next loop iteration reloads it.
    if (res.status === "applied" && batch.remaining === 0) return { simulatedDays: simulated, pendingDays: 0 };
  }
  const { row } = await load();
  return { simulatedDays: simulated, pendingDays: countPendingDays(row.last_simulated_day, today) };
}

interface ActionRow {
  id: string;
  action_type: string;
  category: string | null;
  planned_minutes: number;
  outcome: RivalActionView["outcome"];
  grade: string | null;
  xp_awarded: number;
  gold_delta: number;
  narrative_text: string;
  simulation_day: string;
  action_index: number;
}

function toActionView(a: ActionRow): RivalActionView {
  return {
    id: a.id,
    day: a.simulation_day,
    index: a.action_index,
    type: a.action_type as RivalActionView["type"],
    category: a.category,
    minutes: a.planned_minutes,
    outcome: a.outcome,
    grade: a.grade,
    xp: a.xp_awarded,
    gold: a.gold_delta,
    text: a.narrative_text,
  };
}

export async function getRivalSummary(
  db: SupabaseClient,
  profileId: string,
  weekStart: string,
  pendingDays: number,
): Promise<RivalSummary | null> {
  const r = await db
    .from("rival_profiles")
    .select("id, name, level, total_xp, last_simulated_day")
    .eq("game_profile_id", profileId)
    .maybeSingle();
  if (r.error) throw fromDbError(r.error);
  if (!r.data) return null;
  const [week, last] = await Promise.all([
    db.from("rival_actions").select("xp_awarded").eq("rival_id", r.data.id).gte("simulation_day", weekStart),
    db
      .from("rival_actions")
      .select("*")
      .eq("rival_id", r.data.id)
      .order("simulation_day", { ascending: false })
      .order("action_index", { ascending: false })
      .limit(1)
      .maybeSingle<ActionRow>(),
  ]);
  if (week.error) throw fromDbError(week.error);
  if (last.error) throw fromDbError(last.error);
  const totalXp = Number(r.data.total_xp);
  return {
    name: r.data.name,
    level: r.data.level,
    totalXp,
    progress: levelProgress(totalXp),
    weekXp: (week.data ?? []).reduce((s, a) => s + a.xp_awarded, 0),
    lastSimulatedDay: r.data.last_simulated_day,
    pendingDays,
    lastAction: last.data ? toActionView(last.data) : null,
  };
}

export async function getRivalView(db: SupabaseClient, userId: string): Promise<RivalView> {
  const p = await db
    .from("game_profiles")
    .select("id, level, total_xp, users(timezone)")
    .eq("user_id", userId)
    .maybeSingle<{ id: string; level: number; total_xp: number | string; users: { timezone: string } | null }>();
  if (p.error) throw fromDbError(p.error);
  if (!p.data) throw new ApiError("PROFILE_NOT_FOUND");
  const tz = p.data.users?.timezone ?? "UTC";
  const pid = p.data.id;
  const sync = await syncRival(db, userId, pid, tz);
  const periods = questPeriods(new Date(), tz);

  const [summary, stats, skills, heroSkills, kingdom, actions, heroWeek] = await Promise.all([
    getRivalSummary(db, pid, periods.weekStart, sync.pendingDays),
    db
      .from("character_stats")
      .select("wisdom, willpower, strategy, management, capital, compassion")
      .eq("game_profile_id", pid)
      .eq("character_type", "RIVAL")
      .maybeSingle<HeroStats>(),
    db.from("skills").select("skill_code, level, xp").eq("game_profile_id", pid).eq("character_type", "RIVAL"),
    db.from("skills").select("skill_code, level, xp").eq("game_profile_id", pid).eq("character_type", "HERO"),
    db
      .from("kingdoms")
      .select("name, gold, food, knowledge, influence, command_points")
      .eq("game_profile_id", pid)
      .eq("owner_type", "RIVAL")
      .maybeSingle(),
    loadRivalActions(db, pid, 40),
    db.from("quest_completions").select("awarded_xp").eq("game_profile_id", pid).gte("completed_at", periods.weekStartAt.toISOString()),
  ]);
  for (const x of [stats, skills, heroSkills, kingdom, heroWeek]) if (x.error) throw fromDbError(x.error);
  if (!summary) throw new ApiError("RIVAL_NOT_FOUND");

  const byCode = (rows: { skill_code: string; level: number; xp: number | string }[] | null) =>
    Object.fromEntries((rows ?? []).map((s) => [s.skill_code, { level: s.level, xp: Number(s.xp) }]));
  const rivalSkills = byCode(skills.data);
  const mine = byCode(heroSkills.data);
  const k = kingdom.data;

  return {
    ...summary,
    stats: stats.data ?? { wisdom: 0, willpower: 0, strategy: 0, management: 0, capital: 0, compassion: 0 },
    skills: SKILL_CODES.map((code) => ({
      code,
      level: rivalSkills[code]?.level ?? 1,
      xp: rivalSkills[code]?.xp ?? 0,
      progress: levelProgress(rivalSkills[code]?.xp ?? 0),
      heroLevel: mine[code]?.level ?? 1,
    })),
    kingdom: {
      name: k?.name ?? KAEL.kingdomName,
      gold: Number(k?.gold ?? 0),
      food: Number(k?.food ?? 0),
      knowledge: Number(k?.knowledge ?? 0),
      influence: Number(k?.influence ?? 0),
      commandPoints: Number(k?.command_points ?? 0),
    },
    actions,
    hero: {
      level: p.data.level,
      totalXp: Number(p.data.total_xp),
      weekXp: (heroWeek.data ?? []).reduce((s, c) => s + c.awarded_xp, 0),
    },
  };
}

export async function loadRivalActions(db: SupabaseClient, profileId: string, limit: number, beforeDay?: string) {
  const r = await db.from("rival_profiles").select("id").eq("game_profile_id", profileId).maybeSingle();
  if (r.error) throw fromDbError(r.error);
  if (!r.data) return [];
  let q = db
    .from("rival_actions")
    .select("*")
    .eq("rival_id", r.data.id)
    .order("simulation_day", { ascending: false })
    .order("action_index", { ascending: true })
    .limit(limit);
  if (beforeDay) q = q.lt("simulation_day", beforeDay);
  const { data, error } = await q;
  if (error) throw fromDbError(error);
  return ((data ?? []) as ActionRow[]).map(toActionView);
}
