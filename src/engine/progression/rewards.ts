import { xpReward, type Grade } from "./xp";
import type { SkillCode } from "@/data/skills";

/** Difficulty 1..5 → XP per minute, in hundredths. */
const DIFFICULTY_RATE: Readonly<Record<number, number>> = {
  1: 120,
  2: 150,
  3: 180,
  4: 210,
  5: 250,
};

export const MIN_QUEST_MINUTES = 5;
export const MAX_QUEST_MINUTES = 240;

/**
 * Base XP depends only on planned effort (time × difficulty), never on
 * money, position size, leverage or number of trades (ТЗ §8.4).
 */
export function baseXpFor(minutes: number, difficulty: number): number {
  if (!Number.isInteger(minutes) || minutes < MIN_QUEST_MINUTES || minutes > MAX_QUEST_MINUTES) {
    throw new RangeError(`minutes out of range: ${minutes}`);
  }
  const rate = DIFFICULTY_RATE[difficulty];
  if (rate === undefined) throw new RangeError(`difficulty out of range: ${difficulty}`);
  return Math.floor((minutes * rate + 50) / 100);
}

const LEARNING_SKILLS: ReadonlySet<SkillCode> = new Set<SkillCode>([
  "english",
  "hebrew",
  "trading_analysis",
]);

export interface QuestReward {
  xp: number;
  gold: number;
  knowledge: number;
}

/** Real effort also feeds the kingdom: gold for every quest, knowledge for study. */
export function questReward(baseXp: number, grade: Grade, category: SkillCode): QuestReward {
  const xp = xpReward(baseXp, grade);
  return {
    xp,
    gold: Math.floor(xp / 2),
    knowledge: LEARNING_SKILLS.has(category) ? Math.floor(xp / 5) : 0,
  };
}

/** Anti-farming limits for user-created quests (ТЗ §6.3). */
export const MANUAL_QUEST_LIMITS = {
  maxPerDay: 3,
  dailyXpCap: 60,
} as const;

/** Clamp a reward so the day's manual XP never exceeds the cap. */
export function applyDailyCap(reward: QuestReward, alreadyToday: number, cap: number): QuestReward {
  const allowed = Math.max(0, cap - Math.max(0, alreadyToday));
  if (reward.xp <= allowed) return reward;
  if (reward.xp === 0) return reward;
  const scale = (v: number) => Math.floor((v * allowed) / reward.xp);
  return { xp: allowed, gold: scale(reward.gold), knowledge: scale(reward.knowledge) };
}
