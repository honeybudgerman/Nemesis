import {
  DAILY_TEMPLATES,
  MONTHLY_TEMPLATES,
  WEEKLY_TEMPLATES,
  type DailySlot,
  type EvaluationMode,
  type QuestFrequency,
  type QuestTemplate,
} from "@/data/quests/templates";
import type { SkillCode } from "@/data/skills";
import { baseXpFor, MIN_QUEST_MINUTES } from "@/engine/progression/rewards";
import { createSeededRandom, hashString, pickMany, pickOne } from "@/lib/random";

export interface PlannedQuest {
  templateCode: string;
  title: string;
  description: string;
  category: SkillCode;
  frequency: QuestFrequency;
  difficulty: number;
  estimatedMinutes: number;
  baseXp: number;
  isOptional: boolean;
  successCriteria: string[];
  evaluationMode: EvaluationMode;
  scheduledDate: string; // YYYY-MM-DD (local)
  deadlineAt: string; // ISO UTC
}

export const MIN_DAILY_MINUTES = 30;
export const MAX_DAILY_MINUTES = 240;
export const WEEKLY_QUEST_COUNT = 2;
export const MONTHLY_QUEST_COUNT = 2;

const MAIN_SLOTS: readonly DailySlot[] = ["language", "trading", "discipline"];

function toPlanned(
  t: QuestTemplate,
  minutes: number,
  scheduledDate: string,
  deadline: Date,
  isOptional: boolean,
): PlannedQuest {
  return {
    templateCode: t.code,
    title: t.title,
    description: t.description,
    category: t.category,
    frequency: t.frequency,
    difficulty: t.difficulty,
    estimatedMinutes: minutes,
    baseXp: baseXpFor(minutes, t.difficulty),
    isOptional,
    successCriteria: [...t.successCriteria],
    evaluationMode: t.evaluationMode,
    scheduledDate,
    deadlineAt: deadline.toISOString(),
  };
}

/**
 * Shrink minutes proportionally so the main quests fit the daily budget
 * (ТЗ §8.1). Rounds down and never goes below MIN_QUEST_MINUTES.
 */
export function fitToBudget(minutes: readonly number[], budget: number): number[] {
  const total = minutes.reduce((a, b) => a + b, 0);
  if (total <= budget) return [...minutes];
  return minutes.map((m) => Math.max(MIN_QUEST_MINUTES, Math.floor((m * budget) / total)));
}

/**
 * Daily plan: 3 main quests (one per slot) + 1 optional. Deterministic per
 * (profile, date) so concurrent requests produce the same set.
 */
export function planDailyQuests(
  profileId: string,
  date: string,
  dailyMinutes: number,
  deadline: Date,
): PlannedQuest[] {
  const budget = Math.min(MAX_DAILY_MINUTES, Math.max(MIN_DAILY_MINUTES, dailyMinutes));
  const rng = createSeededRandom(hashString(`daily:${profileId}:${date}`));
  const main = MAIN_SLOTS.map((slot) =>
    pickOne(
      DAILY_TEMPLATES.filter((t) => t.slot === slot),
      rng,
    ),
  );
  const fitted = fitToBudget(
    main.map((t) => t.minutes),
    budget,
  );
  const optional = pickOne(
    DAILY_TEMPLATES.filter((t) => t.slot === "optional"),
    rng,
  );
  return [
    ...main.map((t, i) => toPlanned(t, fitted[i], date, deadline, false)),
    toPlanned(optional, optional.minutes, date, deadline, true),
  ];
}

export function planWeeklyQuests(profileId: string, weekStart: string, deadline: Date): PlannedQuest[] {
  const rng = createSeededRandom(hashString(`weekly:${profileId}:${weekStart}`));
  return pickMany(WEEKLY_TEMPLATES, WEEKLY_QUEST_COUNT, rng).map((t) =>
    toPlanned(t, t.minutes, weekStart, deadline, false),
  );
}

export function planMonthlyQuests(profileId: string, monthStart: string, deadline: Date): PlannedQuest[] {
  const rng = createSeededRandom(hashString(`monthly:${profileId}:${monthStart}`));
  return pickMany(MONTHLY_TEMPLATES, MONTHLY_QUEST_COUNT, rng).map((t) =>
    toPlanned(t, t.minutes, monthStart, deadline, false),
  );
}
