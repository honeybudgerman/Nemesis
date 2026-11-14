import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { STARTING_HERO_STATS, STARTING_RESOURCES } from "@/data/kingdom";
import { isSkillCode, SKILL_CODES } from "@/data/skills";
import { applyDailyCap, baseXpFor, MANUAL_QUEST_LIMITS, questReward } from "@/engine/progression/rewards";
import { levelProgress, SELF_REPORT_GRADE, type Grade } from "@/engine/progression/xp";
import {
  planDailyQuests,
  planMonthlyQuests,
  planWeeklyQuests,
  type PlannedQuest,
} from "@/engine/quests/planner";
import { questPeriods } from "@/lib/time";
import { ApiError, fromDbError } from "@/server/http/errors";
import { getAdminSupabase } from "@/server/supabase/admin";
import { getRivalSummary, syncRival } from "@/server/services/rival-service";
import type {
  CreateQuestInput,
  CompleteQuestInput,
  StartGameInput,
} from "@/server/validation";
import type { CompleteQuestResult, GameEventView, GameState, QuestView } from "@/types/game";

// ---------------------------------------------------------------------------
// Row shapes (subset of columns we read)
// ---------------------------------------------------------------------------
interface UserRow {
  display_name: string;
  timezone: string;
  daily_minutes: number;
}
interface ProfileRow {
  id: string;
  hero_name: string;
  kingdom_name: string;
  level: number;
  total_xp: number | string;
  rank: string;
  current_chapter: number;
  created_at: string;
}
interface QuestRow {
  id: string;
  title: string;
  description: string;
  category: string;
  frequency: QuestView["frequency"];
  difficulty: number;
  estimated_minutes: number;
  base_xp: number;
  is_optional: boolean;
  success_criteria: unknown;
  status: QuestView["status"];
  grade: Grade | null;
  scheduled_date: string;
  deadline_at: string;
  completed_at: string | null;
  source: QuestView["source"];
  evaluation_mode: QuestView["evaluationMode"];
  created_at: string;
}

const num = (v: number | string | null | undefined): number => (v == null ? 0 : Number(v));

function toQuestView(r: QuestRow): QuestView {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    category: r.category,
    frequency: r.frequency,
    difficulty: r.difficulty,
    estimatedMinutes: r.estimated_minutes,
    baseXp: r.base_xp,
    isOptional: r.is_optional,
    successCriteria: Array.isArray(r.success_criteria)
      ? r.success_criteria.filter((x): x is string => typeof x === "string")
      : [],
    status: r.status,
    grade: r.grade,
    scheduledDate: r.scheduled_date,
    deadlineAt: r.deadline_at,
    completedAt: r.completed_at,
    source: r.source,
    evaluationMode: r.evaluation_mode,
  };
}

function plannedToRow(q: PlannedQuest) {
  return {
    template_code: q.templateCode,
    title: q.title,
    description: q.description,
    category: q.category,
    frequency: q.frequency,
    difficulty: q.difficulty,
    estimated_minutes: q.estimatedMinutes,
    base_xp: q.baseXp,
    is_optional: q.isOptional,
    success_criteria: q.successCriteria,
    scheduled_date: q.scheduledDate,
    deadline_at: q.deadlineAt,
    evaluation_mode: q.evaluationMode,
  };
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getAdminSupabase().rpc(fn, args);
  if (error) throw fromDbError(error);
  return data as T;
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------
export async function getProfileSummary(db: SupabaseClient, userId: string) {
  const { data, error } = await db
    .from("game_profiles")
    .select("id, hero_name, kingdom_name, level, rank")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw fromDbError(error);
  return data
    ? { hasProfile: true as const, profile: { id: data.id, heroName: data.hero_name, kingdomName: data.kingdom_name, level: data.level, rank: data.rank } }
    : { hasProfile: false as const, profile: null };
}

export async function startGame(userId: string, input: StartGameInput) {
  return rpc<{ profile_id: string; created: boolean }>("start_game", {
    p_user_id: userId,
    p_display_name: input.displayName,
    p_timezone: input.timezone,
    p_daily_minutes: input.dailyMinutes,
    p_hero_name: input.heroName,
    p_kingdom_name: input.kingdomName,
    p_skill_codes: [...SKILL_CODES],
    p_resources: STARTING_RESOURCES,
    p_stats: STARTING_HERO_STATS,
  });
}

// ---------------------------------------------------------------------------
// State (server is the source of truth)
// ---------------------------------------------------------------------------
async function loadUserAndProfile(db: SupabaseClient, userId: string) {
  const [u, p] = await Promise.all([
    db.from("users").select("display_name, timezone, daily_minutes").eq("id", userId).maybeSingle<UserRow>(),
    db
      .from("game_profiles")
      .select("id, hero_name, kingdom_name, level, total_xp, rank, current_chapter, created_at")
      .eq("user_id", userId)
      .maybeSingle<ProfileRow>(),
  ]);
  if (u.error) throw fromDbError(u.error);
  if (p.error) throw fromDbError(p.error);
  if (!u.data || !p.data) throw new ApiError("PROFILE_NOT_FOUND");
  return { user: u.data, profile: p.data };
}

/** Ensure the current day/week/month quests exist and overdue ones are expired. */
async function syncQuests(userId: string, profileId: string, user: UserRow, now: Date) {
  const periods = questPeriods(now, user.timezone);
  const planned = [
    ...planDailyQuests(profileId, periods.today, user.daily_minutes, periods.dayEnd),
    ...planWeeklyQuests(profileId, periods.weekStart, periods.weekEnd),
    ...planMonthlyQuests(profileId, periods.monthStart, periods.monthEnd),
  ];
  await rpc("sync_quests", { p_user_id: userId, p_quests: planned.map(plannedToRow) });
  return periods;
}

export async function getGameState(db: SupabaseClient, userId: string): Promise<GameState> {
  const now = new Date();
  const { user, profile } = await loadUserAndProfile(db, userId);
  const periods = await syncQuests(userId, profile.id, user, now);

  const pid = profile.id;
  const rival = await loadRivalSummary(db, userId, pid, user.timezone, periods.weekStart);
  const [stats, skills, kingdom, quests, events, weekCompletions] = await Promise.all([
    db
      .from("character_stats")
      .select("wisdom, willpower, strategy, management, capital, compassion")
      .eq("game_profile_id", pid)
      .eq("character_type", "HERO")
      .maybeSingle(),
    db.from("skills").select("skill_code, level, xp").eq("game_profile_id", pid).eq("character_type", "HERO"),
    db
      .from("kingdoms")
      .select("name, gold, food, knowledge, influence, command_points")
      .eq("game_profile_id", pid)
      .eq("owner_type", "HERO")
      .maybeSingle(),
    db
      .from("quests")
      .select("*")
      .eq("game_profile_id", pid)
      .or(
        `and(frequency.eq.DAILY,scheduled_date.eq.${periods.today}),` +
          `and(frequency.eq.WEEKLY,scheduled_date.eq.${periods.weekStart}),` +
          `and(frequency.eq.MONTHLY,scheduled_date.eq.${periods.monthStart})`,
      )
      .order("is_optional", { ascending: true })
      .order("created_at", { ascending: true }),
    db
      .from("game_events")
      .select("id, event_type, payload, created_at")
      .eq("game_profile_id", pid)
      .order("created_at", { ascending: false })
      .limit(8),
    db
      .from("quest_completions")
      .select("awarded_xp, completed_at")
      .eq("game_profile_id", pid)
      .gte("completed_at", periods.weekStartAt.toISOString()),
  ]);
  for (const r of [stats, skills, kingdom, quests, events, weekCompletions]) if (r.error) throw fromDbError(r.error);

  const questViews = ((quests.data ?? []) as QuestRow[]).map(toQuestView);
  const totalXp = num(profile.total_xp);
  const completions = (weekCompletions.data ?? []) as { awarded_xp: number; completed_at: string }[];
  const dayStartMs = periods.dayStart.getTime();
  const weekStartMs = periods.weekStartAt.getTime();

  const k = kingdom.data;
  const s = stats.data;
  return {
    user: { displayName: user.display_name, timezone: user.timezone, dailyMinutes: user.daily_minutes },
    profile: {
      id: profile.id,
      heroName: profile.hero_name,
      kingdomName: profile.kingdom_name,
      level: profile.level,
      totalXp,
      rank: profile.rank,
      currentChapter: profile.current_chapter,
      createdAt: profile.created_at,
      progress: levelProgress(totalXp),
    },
    stats: {
      wisdom: s?.wisdom ?? 0,
      willpower: s?.willpower ?? 0,
      strategy: s?.strategy ?? 0,
      management: s?.management ?? 0,
      capital: s?.capital ?? 0,
      compassion: s?.compassion ?? 0,
    },
    skills: (skills.data ?? [])
      .map((r) => ({ code: r.skill_code as string, level: r.level as number, xp: num(r.xp), progress: levelProgress(num(r.xp)) }))
      .sort((a, b) => SKILL_CODES.indexOf(a.code as never) - SKILL_CODES.indexOf(b.code as never)),
    kingdom: {
      name: k?.name ?? profile.kingdom_name,
      gold: num(k?.gold),
      food: num(k?.food),
      knowledge: num(k?.knowledge),
      influence: num(k?.influence),
      commandPoints: num(k?.command_points),
    },
    quests: {
      daily: questViews.filter((q) => q.frequency === "DAILY"),
      weekly: questViews.filter((q) => q.frequency === "WEEKLY"),
      monthly: questViews.filter((q) => q.frequency === "MONTHLY"),
    },
    periods: { today: periods.today, weekStart: periods.weekStart, monthStart: periods.monthStart },
    xp: {
      today: completions.filter((c) => Date.parse(c.completed_at) >= dayStartMs).reduce((a, c) => a + c.awarded_xp, 0),
      week: completions.filter((c) => Date.parse(c.completed_at) >= weekStartMs).reduce((a, c) => a + c.awarded_xp, 0),
    },
    recentEvents: ((events.data ?? []) as { id: string; event_type: string; payload: Record<string, unknown>; created_at: string }[]).map(
      (e): GameEventView => ({ id: e.id, type: e.event_type, payload: e.payload ?? {}, createdAt: e.created_at }),
    ),
    rival,
    serverTime: now.toISOString(),
  };
}

/**
 * Advance Kael by at most one batch while loading state, so a page load stays
 * fast; the client finishes a long catch-up through /api/rival/sync. A rival
 * failure must never take the throne room down with it.
 */
async function loadRivalSummary(db: SupabaseClient, userId: string, profileId: string, timezone: string, weekStart: string) {
  try {
    const sync = await syncRival(db, userId, profileId, timezone, 1);
    return await getRivalSummary(db, profileId, weekStart, sync.pendingDays);
  } catch (e) {
    console.error("rival sync failed", e instanceof Error ? e.message : e);
    return null;
  }
}


// ---------------------------------------------------------------------------
// Quest actions
// ---------------------------------------------------------------------------
export async function completeQuest(
  db: SupabaseClient,
  userId: string,
  input: CompleteQuestInput,
): Promise<CompleteQuestResult> {
  const { user } = await loadUserAndProfile(db, userId);

  // Read through RLS: proves ownership before any reward math happens.
  const { data: quest, error } = await db
    .from("quests")
    .select("id, base_xp, category, evaluation_mode")
    .eq("id", input.questId)
    .maybeSingle<{ id: string; base_xp: number; category: string; evaluation_mode: string }>();
  if (error) throw fromDbError(error);
  if (!quest) throw new ApiError("QUEST_NOT_FOUND");
  if (!isSkillCode(quest.category)) throw new ApiError("VALIDATION_ERROR", "Неизвестная категория задания.");

  // Sprint 1: only self-reported quests; QUIZ / AI_REVIEW grading arrives with Orion (Sprint 3).
  const grade: Grade = SELF_REPORT_GRADE;
  const reward = questReward(quest.base_xp, grade, quest.category);
  const periods = questPeriods(new Date(), user.timezone);

  const r = await rpc<{
    status: "completed" | "duplicate" | "expired";
    awarded_xp?: number;
    gold?: number;
    knowledge?: number;
    leveled_up?: boolean;
    level?: number;
  }>("complete_quest", {
    p_user_id: userId,
    p_quest_id: quest.id,
    p_idempotency_key: input.idempotencyKey,
    p_grade: grade,
    p_xp: reward.xp,
    p_gold: reward.gold,
    p_knowledge: reward.knowledge,
    p_note: input.note ?? null,
    p_manual_xp_cap: MANUAL_QUEST_LIMITS.dailyXpCap,
    p_day_start: periods.dayStart.toISOString(),
  });

  if (r.status === "expired") throw new ApiError("QUEST_EXPIRED");

  const state = await getGameState(db, userId);
  return {
    status: r.status,
    awardedXp: r.awarded_xp ?? 0,
    gold: r.gold ?? 0,
    knowledge: r.knowledge ?? 0,
    leveledUp: Boolean(r.leveled_up),
    level: r.level ?? state.profile.level,
    state,
  };
}

export async function skipQuest(db: SupabaseClient, userId: string, questId: string): Promise<GameState> {
  await rpc("skip_quest", { p_user_id: userId, p_quest_id: questId });
  return getGameState(db, userId);
}

export async function createManualQuest(db: SupabaseClient, userId: string, input: CreateQuestInput): Promise<GameState> {
  const { user } = await loadUserAndProfile(db, userId);
  const periods = questPeriods(new Date(), user.timezone);
  // XP is assigned by the engine from time × difficulty, never by the client.
  const preview = applyDailyCap(
    { xp: baseXpFor(input.estimatedMinutes, input.difficulty), gold: 0, knowledge: 0 },
    0,
    MANUAL_QUEST_LIMITS.dailyXpCap,
  );
  await rpc("create_manual_quest", {
    p_user_id: userId,
    p_quest: {
      title: input.title,
      description: input.description,
      category: input.category,
      difficulty: input.difficulty,
      estimated_minutes: input.estimatedMinutes,
      base_xp: preview.xp,
      success_criteria: [],
      scheduled_date: periods.today,
      deadline_at: periods.dayEnd.toISOString(),
    },
    p_day_start: periods.dayStart.toISOString(),
    p_max_per_day: MANUAL_QUEST_LIMITS.maxPerDay,
  });
  return getGameState(db, userId);
}

// ---------------------------------------------------------------------------
// Export / delete (ТЗ §16.4, §17)
// ---------------------------------------------------------------------------
export async function exportProgress(db: SupabaseClient, userId: string) {
  const { user, profile } = await loadUserAndProfile(db, userId);
  const pid = profile.id;
  const tables = ["character_stats", "skills", "quests", "quest_completions", "kingdoms", "resource_ledger", "game_events"] as const;
  const results = await Promise.all(
    tables.map((t) => db.from(t).select("*").eq("game_profile_id", pid).order("id")),
  );
  const data: Record<string, unknown> = {};
  tables.forEach((t, i) => {
    if (results[i].error) throw fromDbError(results[i].error);
    data[t] = results[i].data;
  });
  const rival = await db.from("rival_profiles").select("*").eq("game_profile_id", pid).maybeSingle();
  if (rival.error) throw fromDbError(rival.error);
  let rivalActions: unknown[] = [];
  if (rival.data) {
    const a = await db.from("rival_actions").select("*").eq("rival_id", rival.data.id).order("simulation_day").order("action_index");
    if (a.error) throw fromDbError(a.error);
    rivalActions = a.data ?? [];
  }
  return {
    format: "nemesis-export",
    version: 2,
    exportedAt: new Date().toISOString(),
    user: { display_name: user.display_name, timezone: user.timezone, daily_minutes: user.daily_minutes },
    game_profile: profile,
    ...data,
    rival_profile: rival.data,
    rival_actions: rivalActions,
  };
}

export async function deleteGame(userId: string) {
  return rpc("delete_game", { p_user_id: userId });
}
