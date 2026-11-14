/**
 * Progression rules (ТЗ §6). Pure functions, no I/O.
 *
 * The SQL functions `nemesis_xp_required` / `nemesis_level_for_xp` /
 * `nemesis_rank_for_level` in supabase/migrations mirror these rules so the
 * level can be recomputed atomically inside a transaction. A parity test in
 * tests/integration keeps both implementations identical.
 */

export const MAX_LEVEL = 1000;

export const GRADES = ["S", "A", "B", "C", "D", "F"] as const;
export type Grade = (typeof GRADES)[number];

/** Grade multipliers as integer percentages to avoid floating point drift. */
export const GRADE_PERCENT: Readonly<Record<Grade, number>> = {
  S: 120,
  A: 100,
  B: 85,
  C: 70,
  D: 40,
  F: 0,
};

/** Grade for a plain self-report without additional verification (ТЗ §6.2). */
export const SELF_REPORT_GRADE: Grade = "A";

function assertNonNegativeInt(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer, got ${value}`);
  }
}

/** XP cost of the transition from level L to L+1: round(100 × L^1.5). */
export function xpRequired(level: number): number {
  if (!Number.isInteger(level) || level < 1) {
    throw new RangeError(`level must be an integer >= 1, got ${level}`);
  }
  return Math.round(100 * Math.pow(level, 1.5));
}

/** Total XP needed to reach `level` from level 1. */
export function totalXpForLevel(level: number): number {
  let sum = 0;
  for (let l = 1; l < level; l++) sum += xpRequired(l);
  return sum;
}

export interface LevelProgress {
  level: number;
  /** XP accumulated inside the current level. */
  xpIntoLevel: number;
  /** XP cost of the current level's transition. */
  xpForNext: number;
  /** 0..1 */
  ratio: number;
}

/** Level is found by subtracting transition costs sequentially (ТЗ §6.1). */
export function levelProgress(totalXp: number): LevelProgress {
  assertNonNegativeInt(totalXp, "totalXp");
  let level = 1;
  let remaining = totalXp;
  while (level < MAX_LEVEL && remaining >= xpRequired(level)) {
    remaining -= xpRequired(level);
    level++;
  }
  const xpForNext = xpRequired(level);
  return {
    level,
    xpIntoLevel: remaining,
    xpForNext,
    ratio: Math.min(1, remaining / xpForNext),
  };
}

export function levelForXp(totalXp: number): number {
  return levelProgress(totalXp).level;
}

/** XP_reward = round(BaseXP × GradeMultiplier), computed in integers. */
export function xpReward(baseXp: number, grade: Grade): number {
  assertNonNegativeInt(baseXp, "baseXp");
  const pct = GRADE_PERCENT[grade];
  // round half up on non-negative integers: floor((base*pct + 50) / 100)
  return Math.floor((baseXp * pct + 50) / 100);
}

export const RANKS: ReadonlyArray<{ minLevel: number; title: string }> = [
  { minLevel: 1, title: "Наследник" },
  { minLevel: 5, title: "Рыцарь" },
  { minLevel: 10, title: "Барон" },
  { minLevel: 15, title: "Граф" },
  { minLevel: 20, title: "Герцог" },
  { minLevel: 30, title: "Король" },
  { minLevel: 50, title: "Верховный король" },
];

export function rankForLevel(level: number): string {
  let title = RANKS[0].title;
  for (const r of RANKS) if (level >= r.minLevel) title = r.title;
  return title;
}
