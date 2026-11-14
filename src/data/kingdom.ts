/** Starting resources (ТЗ §10.1). Army and territories arrive in Sprint 4. */
export const STARTING_RESOURCES = {
  gold: 500,
  food: 200,
  knowledge: 0,
  influence: 0,
  command_points: 3,
} as const;

/** Starting hero characteristics, 0..100 (ТЗ §5.3). */
export const STARTING_HERO_STATS = {
  wisdom: 10,
  willpower: 10,
  strategy: 10,
  management: 10,
  capital: 10,
  compassion: 10,
} as const;

export const RESOURCE_LABELS = {
  gold: "Золото",
  food: "Провизия",
  knowledge: "Знания",
  influence: "Влияние",
  command_points: "Командование",
} as const;
