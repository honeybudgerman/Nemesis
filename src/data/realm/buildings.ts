/**
 * Six building types (ТЗ §10.2). Production is fixed by rules (§10.3): level ×
 * base rate × terrain modifier. Costs grow linearly with the next level.
 */
import type { Terrain } from "./map";

export const BUILDING_TYPES = ["castle", "farm", "market", "barracks", "academy", "palace"] as const;
export type BuildingType = (typeof BUILDING_TYPES)[number];

export interface BuildingDef {
  type: BuildingType;
  name: string;
  icon: string;
  description: string;
  maxLevel: number;
  /** Cost of reaching level L = perLevel × L. */
  cost: { gold: number; food: number };
  /** Minutes to build level L = minutesPerLevel × L. */
  minutesPerLevel: number;
  /** Daily production per level. */
  produces: Partial<Record<"gold" | "food" | "knowledge" | "influence", number>>;
  terrainBonus: Partial<Record<Terrain, number>>;
  /** Only in the capital. */
  capitalOnly?: boolean;
}

export const BUILDINGS: Readonly<Record<BuildingType, BuildingDef>> = {
  castle: {
    type: "castle", name: "Замок", icon: "🏰", description: "Административный центр: открывает высокие уровни построек и даёт очки командования.",
    maxLevel: 5, cost: { gold: 200, food: 50 }, minutesPerLevel: 60, produces: { gold: 10, influence: 1 }, terrainBonus: {}, capitalOnly: true,
  },
  farm: {
    type: "farm", name: "Ферма", icon: "🌾", description: "Производит провизию для народа и армии.",
    maxLevel: 5, cost: { gold: 80, food: 0 }, minutesPerLevel: 30, produces: { food: 20 }, terrainBonus: { plains: 1.25, river: 1.25, mountains: 0.5 },
  },
  market: {
    type: "market", name: "Рынок", icon: "⚖️", description: "Приносит золото от торговли.",
    maxLevel: 5, cost: { gold: 100, food: 20 }, minutesPerLevel: 30, produces: { gold: 15 }, terrainBonus: { coast: 1.25, river: 1.25 },
  },
  barracks: {
    type: "barracks", name: "Казармы", icon: "🛡️", description: "Открывают найм войск. Чем выше уровень, тем сильнее войска и больше армия.",
    maxLevel: 5, cost: { gold: 120, food: 40 }, minutesPerLevel: 40, produces: {}, terrainBonus: {},
  },
  academy: {
    type: "academy", name: "Академия", icon: "📚", description: "Исследования: приносит знания и открывает магов.",
    maxLevel: 5, cost: { gold: 150, food: 20 }, minutesPerLevel: 45, produces: { knowledge: 3 }, terrainBonus: { forest: 1.25 },
  },
  palace: {
    type: "palace", name: "Дворец", icon: "👑", description: "Центр придворной жизни: приносит влияние.",
    maxLevel: 5, cost: { gold: 180, food: 30 }, minutesPerLevel: 60, produces: { influence: 2 }, terrainBonus: {}, capitalOnly: true,
  },
};

export function buildingCost(type: BuildingType, level: number) {
  const c = BUILDINGS[type].cost;
  return { gold: c.gold * level, food: c.food * level };
}

export function buildingMinutes(type: BuildingType, level: number) {
  return BUILDINGS[type].minutesPerLevel * level;
}

/** Other buildings can be at most one level above the castle. */
export function maxLevelFor(type: BuildingType, castleLevel: number) {
  return type === "castle" ? BUILDINGS.castle.maxLevel : Math.min(BUILDINGS[type].maxLevel, castleLevel + 1);
}
