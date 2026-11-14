import type { SkillCode } from "@/data/skills";

/**
 * Kael Valkarion — balance parameters (ТЗ §7.2). These are calibration knobs,
 * not rules: change them here and bump SIMULATION_VERSION so already-simulated
 * days stay reproducible under the version they were produced with.
 */
export const SIMULATION_VERSION = 1;

export const KAEL = {
  name: "Каэль Валькарион",
  kingdomName: "Чёрный Предел",
  disciplineFactor: 0.78,
  learningFactor: 1.0,
  riskTolerance: 0.45,
  dailyMinutes: 45,
} as const;

/** Kael's character: strong in trading and strategy, weak in languages and risk control. */
export const KAEL_SKILL_AFFINITY: Readonly<Record<SkillCode, number>> = {
  english: 0.9,
  hebrew: 0.5,
  trading_analysis: 1.5,
  risk_management: 0.7,
  discipline: 1.1,
  time_management: 0.9,
};

export const KAEL_STARTING_STATS = {
  wisdom: 12,
  willpower: 14,
  strategy: 18,
  management: 12,
  capital: 15,
  compassion: 6,
} as const;

/** Max days applied per database transaction, and per HTTP request. */
export const SIMULATION_BATCH_DAYS = 31;
export const SIMULATION_MAX_BATCHES_PER_REQUEST = 3;
