/**
 * Progress metrics: numbers taken from real game state. Chapter objectives and
 * achievements are all "metric ≥ target", so the database can re-check every
 * one of them with the same definition (nemesis_story_metrics in SQL).
 */
export const PROGRESS_METRICS = [
  "questsCompleted",
  "heroLevel",
  "skillLevel",
  "buildings",
  "battlesWon",
  "territories",
  "armyPower",
  "courtFriends",
  "courtEventsResolved",
  "positionsFilled",
  "bossesDefeated",
  "chaptersCompleted",
] as const;
export type ProgressMetric = (typeof PROGRESS_METRICS)[number];
export type ProgressFacts = Record<ProgressMetric, number>;

export const METRIC_LABELS: Readonly<Record<ProgressMetric, string>> = {
  questsCompleted: "Выполнено заданий",
  heroLevel: "Уровень героя",
  skillLevel: "Лучший навык",
  buildings: "Построено зданий",
  battlesWon: "Побед в боях",
  territories: "Территорий",
  armyPower: "Сила армии",
  courtFriends: "Друзей при дворе",
  courtEventsResolved: "Решений при дворе",
  positionsFilled: "Занятых должностей",
  bossesDefeated: "Побеждено боссов",
  chaptersCompleted: "Пройдено глав",
};

export const EMPTY_FACTS: ProgressFacts = Object.fromEntries(PROGRESS_METRICS.map((m) => [m, 0])) as ProgressFacts;
