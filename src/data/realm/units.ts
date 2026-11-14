/** Five unit types (ТЗ §11.1). Power = attack + defense + health/10. */
export const UNIT_TYPES = ["infantry", "archers", "cavalry", "mages", "royal_guard"] as const;
export type UnitType = (typeof UNIT_TYPES)[number];

export interface UnitDef {
  type: UnitType;
  name: string;
  icon: string;
  attack: number;
  defense: number;
  health: number;
  /** Food per unit per day. */
  upkeep: number;
  cost: { gold: number; food: number; knowledge: number; influence: number };
  tier: 1 | 2 | 3;
  requires: { barracks: number; academy?: number; castle?: number };
}

export const UNITS: Readonly<Record<UnitType, UnitDef>> = {
  infantry: { type: "infantry", name: "Пехота", icon: "🗡️", attack: 4, defense: 5, health: 30, upkeep: 1, cost: { gold: 20, food: 5, knowledge: 0, influence: 0 }, tier: 1, requires: { barracks: 1 } },
  archers: { type: "archers", name: "Лучники", icon: "🏹", attack: 6, defense: 3, health: 20, upkeep: 1, cost: { gold: 30, food: 5, knowledge: 0, influence: 0 }, tier: 1, requires: { barracks: 1 } },
  cavalry: { type: "cavalry", name: "Кавалерия", icon: "🐎", attack: 8, defense: 6, health: 40, upkeep: 2, cost: { gold: 60, food: 15, knowledge: 0, influence: 0 }, tier: 2, requires: { barracks: 2 } },
  mages: { type: "mages", name: "Маги", icon: "🔮", attack: 12, defense: 2, health: 18, upkeep: 2, cost: { gold: 80, food: 5, knowledge: 10, influence: 0 }, tier: 2, requires: { barracks: 3, academy: 1 } },
  royal_guard: { type: "royal_guard", name: "Королевская гвардия", icon: "⚜️", attack: 10, defense: 10, health: 50, upkeep: 3, cost: { gold: 120, food: 20, knowledge: 0, influence: 5 }, tier: 3, requires: { barracks: 4, castle: 3 } },
};

export const TIER_MODIFIER: Readonly<Record<1 | 2 | 3, number>> = { 1: 1.0, 2: 1.25, 3: 1.5 };

export function unitPower(type: UnitType): number {
  const u = UNITS[type];
  return u.attack + u.defense + Math.floor(u.health / 10);
}

export const STARTING_ARMY: Readonly<Partial<Record<UnitType, number>>> = { infantry: 5 };

/** Army size cap: grows with castle and barracks. */
export function maxArmySize(castleLevel: number, barracksLevel: number): number {
  return 10 + 10 * castleLevel + 10 * barracksLevel;
}

export const TACTICS = {
  cautious: { name: "Осторожная", power: 0.9, losses: 0.6 },
  balanced: { name: "Сбалансированная", power: 1.0, losses: 1.0 },
  aggressive: { name: "Агрессивная", power: 1.1, losses: 1.4 },
} as const;
export type Tactic = keyof typeof TACTICS;
