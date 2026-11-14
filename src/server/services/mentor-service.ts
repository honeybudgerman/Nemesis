import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  chatMessages,
  checkQuestPlan,
  evaluationMessages,
  evaluationSchema,
  EVALUATION_JSON_SCHEMA,
  FALLBACK_REPLIES,
  normalizeQuestPlan,
  aiQuestPlanSchema,
  QUEST_PLAN_JSON_SCHEMA,
  questPlanMessages,
  type Evaluation,
  type MentorFacts,
} from "@/engine/ai/mentor";
import { hashString } from "@/lib/random";
import { aiConfig, aiPeriods, callAi, type GatewayResult } from "@/server/ai/gateway";
import { ApiError, fromDbError } from "@/server/http/errors";
import { getAdminSupabase } from "@/server/supabase/admin";
import { completeQuest, getGameState } from "@/server/services/game-service";
import type { AiStatus, CompleteQuestResult, GameState, MentorEvaluationView, MentorMessageView, MentorView } from "@/types/game";

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getAdminSupabase().rpc(fn, args);
  if (error) throw fromDbError(error);
  return data as T;
}

/** Human-readable reason shown when Orion cannot answer (never internal details). */
export function aiFailureMessage(r: Exclude<GatewayResult<unknown>, { ok: true }>): string {
  switch (r.reason) {
    case "unconfigured":
      return "Орион ещё не подключён: на сервере не задан ключ OpenRouter.";
    case "limited":
      return r.limit === "daily"
        ? "Лимит обращений к Ориону на сегодня исчерпан. Его можно изменить в настройках."
        : "Месячный бюджет на AI исчерпан. Его можно изменить в настройках.";
    case "invalid":
      return "Орион ответил неразборчиво. Попробуйте позже.";
    default:
      return "Орион сейчас недоступен. Игра продолжает работать с подготовленными заданиями.";
  }
}

// ---------------------------------------------------------------------------
// Facts: the only things Orion is allowed to rely on
// ---------------------------------------------------------------------------
async function loadFacts(db: SupabaseClient, state: GameState): Promise<MentorFacts> {
  const since = new Date(Date.now() - 7 * 86400_000).toISOString();
  const [done, topics] = await Promise.all([
    db
      .from("quest_completions")
      .select("grade, completed_at, quests(title, category)")
      .eq("game_profile_id", state.profile.id)
      .gte("completed_at", since)
      .order("completed_at", { ascending: false })
      .limit(10),
    db
      .from("quest_evaluations")
      .select("next_topic")
      .eq("game_profile_id", state.profile.id)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);
  if (done.error) throw fromDbError(done.error);
  const recent = ((done.data ?? []) as unknown as { grade: string; completed_at: string; quests: { title: string; category: string } | null }[])
    .filter((c) => c.quests)
    .map((c) => ({ title: c.quests!.title, category: c.quests!.category, grade: c.grade, day: c.completed_at.slice(0, 10) }));
  return {
    heroName: state.profile.heroName,
    level: state.profile.level,
    rank: state.profile.rank,
    dailyMinutes: state.user.dailyMinutes,
    skills: state.skills.map((s) => ({ code: s.code, level: s.level })),
    today: state.quests.daily.map((q) => ({ title: q.title, category: q.category, status: q.status, optional: q.isOptional })),
    weekly: state.quests.weekly.map((q) => q.title),
    recentCompleted: recent,
    recentTopics: topics.error ? [] : (topics.data ?? []).map((t) => t.next_topic as string).filter(Boolean),
    rival: state.rival ? { level: state.rival.level, weekXp: state.rival.weekXp } : null,
    heroWeekXp: state.xp.week,
  };
}

function planStatus(state: GameState): "available" | "exists" | "too_late" {
  const daily = state.quests.daily;
  if (daily.some((q) => q.source === "AI")) return "exists";
  if (daily.some((q) => q.source === "TEMPLATE" && (q.status === "COMPLETED" || q.status === "SKIPPED"))) return "too_late";
  return "available";
}

// ---------------------------------------------------------------------------
// GenerateDailyQuests
// ---------------------------------------------------------------------------
export interface GenerateResult {
  status: "applied" | "exists" | "too_late" | "fallback";
  message: string;
  state: GameState;
}

export async function generateDailyQuests(db: SupabaseClient, userId: string): Promise<GenerateResult> {
  const state = await getGameState(db, userId);
  // Checked before calling the AI so a repeated tap costs nothing (ТЗ §9.4).
  const pre = planStatus(state);
  if (pre === "exists") return { status: "exists", message: "План Ориона на сегодня уже составлен.", state };
  if (pre === "too_late")
    return { status: "too_late", message: "Сегодня ты уже начал закрывать задания. Орион составит план завтра.", state };

  const facts = await loadFacts(db, state);
  const ai = await callAi(userId, state.user.timezone, "GENERATE_QUESTS", {
    messages: questPlanMessages(facts),
    maxTokens: 1400,
    temperature: 0.8,
    structured: { name: "daily_quest_plan", jsonSchema: QUEST_PLAN_JSON_SCHEMA as unknown as Record<string, unknown>, schema: aiQuestPlanSchema },
    check: checkQuestPlan,
  });
  if (!ai.ok) return { status: "fallback", message: `${aiFailureMessage(ai)} Задания дня остаются прежними.`, state };

  const deadline = state.quests.daily[0]?.deadlineAt ? new Date(state.quests.daily[0].deadlineAt) : new Date(Date.now() + 12 * 3600_000);
  const quests = normalizeQuestPlan(ai.value, state.user.dailyMinutes, deadline);
  const r = await rpc<{ status: "applied" | "exists" | "too_late" }>("apply_ai_daily_quests", {
    p_user_id: userId,
    p_today: state.periods.today,
    p_quests: quests,
  });
  const fresh = await getGameState(db, userId);
  const message =
    r.status === "applied"
      ? "Орион составил план на сегодня."
      : r.status === "exists"
        ? "План Ориона на сегодня уже составлен."
        : "Сегодня ты уже начал закрывать задания. Орион составит план завтра.";
  return { status: r.status, message, state: fresh };
}

// ---------------------------------------------------------------------------
// EvaluateAnswer
// ---------------------------------------------------------------------------
interface EvalRow {
  id: string;
  quest_id: string;
  answer: string;
  grade: Evaluation["grade"];
  reasoning: string;
  mistakes: string[];
  recommendations: string[];
  next_topic: string;
  created_at: string;
}

const toEvalView = (e: EvalRow, title: string): MentorEvaluationView => ({
  id: e.id,
  questId: e.quest_id,
  questTitle: title,
  grade: e.grade,
  reasoning: e.reasoning,
  mistakes: Array.isArray(e.mistakes) ? e.mistakes : [],
  recommendations: Array.isArray(e.recommendations) ? e.recommendations : [],
  nextTopic: e.next_topic,
  createdAt: e.created_at,
});

export type EvaluateResult =
  | { status: "evaluated"; evaluation: MentorEvaluationView; completion: CompleteQuestResult }
  | { status: "ai_unavailable"; message: string };

export async function evaluateAnswer(
  db: SupabaseClient,
  userId: string,
  input: { questId: string; answer: string; idempotencyKey: string },
): Promise<EvaluateResult> {
  const { data: q, error } = await db
    .from("quests")
    .select("id, title, description, category, difficulty, success_criteria, evaluation_mode, status")
    .eq("id", input.questId)
    .maybeSingle();
  if (error) throw fromDbError(error);
  if (!q) throw new ApiError("QUEST_NOT_FOUND");
  if (q.evaluation_mode === "SELF_REPORT") throw new ApiError("VALIDATION_ERROR", "Это задание не требует проверки наставником.");

  const existing = await db.from("quest_evaluations").select("*").eq("quest_id", q.id).maybeSingle<EvalRow>();
  if (existing.error) throw fromDbError(existing.error);
  let row = existing.data;

  if (!row) {
    if (q.status !== "PENDING") throw new ApiError("QUEST_NOT_PENDING");
    const tz = await userTimezone(db, userId);
    const criteria = Array.isArray(q.success_criteria) ? (q.success_criteria as unknown[]).filter((x): x is string => typeof x === "string") : [];
    const ai = await callAi(userId, tz, "EVALUATE", {
      messages: evaluationMessages(
        { title: q.title, description: q.description, category: q.category, difficulty: q.difficulty, successCriteria: criteria },
        input.answer,
      ),
      maxTokens: 900,
      temperature: 0.2,
      structured: { name: "answer_evaluation", jsonSchema: EVALUATION_JSON_SCHEMA as unknown as Record<string, unknown>, schema: evaluationSchema },
    });
    if (!ai.ok) {
      return {
        status: "ai_unavailable",
        message: `${aiFailureMessage(ai)} Можно завершить задание самостоятельно — оно будет засчитано с оценкой B.`,
      };
    }
    row = await rpc<EvalRow>("save_quest_evaluation", {
      p_user_id: userId,
      p_quest_id: q.id,
      p_answer: input.answer,
      p_eval: ai.value,
    });
  }

  const completion = await completeQuest(db, userId, { questId: q.id, idempotencyKey: input.idempotencyKey });
  return { status: "evaluated", evaluation: toEvalView(row, q.title), completion };
}

async function userTimezone(db: SupabaseClient, userId: string): Promise<string> {
  const { data, error } = await db.from("users").select("timezone").eq("id", userId).maybeSingle<{ timezone: string }>();
  if (error) throw fromDbError(error);
  return data?.timezone ?? "UTC";
}

// ---------------------------------------------------------------------------
// MentorChat
// ---------------------------------------------------------------------------
export interface ChatResult {
  reply: MentorMessageView;
  source: "AI" | "FALLBACK";
  notice: string | null;
  messages: MentorMessageView[];
}

async function loadMessages(db: SupabaseClient, profileId: string, limit: number): Promise<MentorMessageView[]> {
  const { data, error } = await db
    .from("mentor_messages")
    .select("id, role, content, source, created_at")
    .eq("game_profile_id", profileId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw fromDbError(error);
  return (data ?? [])
    .map((m) => ({ id: m.id, role: m.role, content: m.content, source: m.source, createdAt: m.created_at }) as MentorMessageView)
    .reverse();
}

export async function mentorChat(db: SupabaseClient, userId: string, message: string): Promise<ChatResult> {
  const state = await getGameState(db, userId);
  const [facts, history] = await Promise.all([loadFacts(db, state), loadMessages(db, state.profile.id, 8)]);
  const ai = await callAi(userId, state.user.timezone, "MENTOR_CHAT", {
    messages: chatMessages(facts, history.map((m) => ({ role: m.role, content: m.content })), message),
    maxTokens: 600,
    temperature: 0.7,
  });

  let reply: string;
  let source: "AI" | "FALLBACK";
  let notice: string | null = null;
  if (ai.ok && typeof ai.value === "string" && ai.value.trim()) {
    reply = ai.value.trim().slice(0, 3000);
    source = "AI";
  } else {
    const pool = FALLBACK_REPLIES;
    reply = pool[hashString(`${message}:${history.length}`) % pool.length].replaceAll("{hero}", state.profile.heroName);
    source = "FALLBACK";
    notice = ai.ok ? null : aiFailureMessage(ai);
  }

  await rpc("add_mentor_messages", {
    p_user_id: userId,
    p_messages: [
      { role: "user", content: message, source: "USER" },
      { role: "mentor", content: reply, source },
    ],
  });
  const messages = await loadMessages(db, state.profile.id, 40);
  return { reply: messages[messages.length - 1], source, notice, messages };
}

// ---------------------------------------------------------------------------
// Mentor screen + AI settings
// ---------------------------------------------------------------------------
export async function getAiStatus(db: SupabaseClient, userId: string, profileId: string): Promise<AiStatus> {
  const { data: u, error } = await db
    .from("users")
    .select("timezone, ai_daily_request_limit, ai_monthly_budget_cents")
    .eq("id", userId)
    .maybeSingle<{ timezone: string; ai_daily_request_limit: number; ai_monthly_budget_cents: number }>();
  if (error) throw fromDbError(error);
  const tz = u?.timezone ?? "UTC";
  const { dayStart, monthStart } = aiPeriods(tz);
  const logs = await db
    .from("ai_usage_logs")
    .select("created_at, cost_micros")
    .eq("game_profile_id", profileId)
    .gte("created_at", monthStart.toISOString());
  if (logs.error) throw fromDbError(logs.error);
  const rows = (logs.data ?? []) as { created_at: string; cost_micros: number | string }[];
  const cfg = aiConfig();
  return {
    configured: cfg.configured,
    model: cfg.model,
    todayRequests: rows.filter((r) => Date.parse(r.created_at) >= dayStart.getTime()).length,
    dailyLimit: u?.ai_daily_request_limit ?? 30,
    monthCostUsd: rows.reduce((s, r) => s + Number(r.cost_micros), 0) / 1_000_000,
    monthlyBudgetUsd: (u?.ai_monthly_budget_cents ?? 300) / 100,
  };
}

export async function getMentorView(db: SupabaseClient, userId: string): Promise<MentorView> {
  const state = await getGameState(db, userId);
  const pid = state.profile.id;
  const [messages, evals, ai] = await Promise.all([
    loadMessages(db, pid, 40),
    db.from("quest_evaluations").select("*, quests(title)").eq("game_profile_id", pid).order("created_at", { ascending: false }).limit(10),
    getAiStatus(db, userId, pid),
  ]);
  if (evals.error) throw fromDbError(evals.error);
  return {
    heroName: state.profile.heroName,
    ai,
    planToday: planStatus(state),
    reviewQuests: state.quests.daily
      .concat(state.quests.weekly)
      .filter((q) => q.status === "PENDING" && q.evaluationMode !== "SELF_REPORT")
      .map((q) => ({ id: q.id, title: q.title })),
    messages,
    evaluations: ((evals.data ?? []) as (EvalRow & { quests: { title: string } | null })[]).map((e) => toEvalView(e, e.quests?.title ?? "Задание")),
  };
}

export async function updateAiSettings(userId: string, input: { dailyLimit: number; monthlyBudgetUsd: number }) {
  await rpc("update_ai_settings", {
    p_user_id: userId,
    p_daily_limit: input.dailyLimit,
    p_budget_cents: Math.round(input.monthlyBudgetUsd * 100),
  });
}
