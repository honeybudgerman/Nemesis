/**
 * Daily economy (ТЗ §10.3): fixed production rules, upkeep, morale and command
 * points. Pure; the server replays finished days in bounded batches like Kael.
 */
import { BUILDINGS, type BuildingType } from "@/data/realm/buildings";
import type { Terrain, TerritoryResource } from "@/data/realm/map";
import { UNIT_TYPES, UNITS } from "@/data/realm/units";
import type { Army } from "./battle";

export type Resources = { gold: number; food: number; knowledge: number; influence: number; command_points: number };

export interface EconomyBuilding {
  type: BuildingType;
  /** Target level; while under construction the previous level still works. */
  level: number;
  terrain: Terrain;
  completedAt: string;
}

export interface EconomyState {
  resources: Resources;
  morale: number;
  buildings: EconomyBuilding[];
  territories: { resource: TerritoryResource }[];
  army: Army;
}

export const TERRITORY_INCOME: Readonly<Record<TerritoryResource, number>> = { gold: 5, food: 10, knowledge: 1, influence: 1 };

export function effectiveLevel(b: EconomyBuilding, at: Date): number {
  return Date.parse(b.completedAt) <= at.getTime() ? b.level : b.level - 1;
}

export function castleLevelAt(buildings: EconomyBuilding[], at: Date): number {
  const c = buildings.find((b) => b.type === "castle");
  return c ? Math.max(1, effectiveLevel(c, at)) : 1;
}

export function maxCommandPoints(castleLevel: number): number {
  return 3 + Math.max(0, castleLevel - 1);
}

export function dailyUpkeep(army: Army): number {
  return UNIT_TYPES.reduce((s, t) => s + (army[t] ?? 0) * UNITS[t].upkeep, 0);
}

/** Gross production for a day that ends at `dayEnd`. */
export function dailyProduction(state: EconomyState, dayEnd: Date): Omit<Resources, "command_points"> {
  const p = { gold: 0, food: 0, knowledge: 0, influence: 0 };
  for (const b of state.buildings) {
    const lvl = effectiveLevel(b, dayEnd);
    if (lvl <= 0) continue;
    const def = BUILDINGS[b.type];
    const mod = def.terrainBonus[b.terrain] ?? 1;
    for (const [res, rate] of Object.entries(def.produces) as [keyof typeof p, number][]) {
      p[res] += Math.floor(rate * lvl * mod);
    }
  }
  for (const t of state.territories) p[t.resource] += TERRITORY_INCOME[t.resource];
  return p;
}

export interface EconomyDay {
  day: string;
  produced: Omit<Resources, "command_points">;
  upkeep: number;
  starving: boolean;
  delta: Resources;
  morale: number;
}

export function simulateEconomyDay(state: EconomyState, day: string, dayEnd: Date): { result: EconomyDay; state: EconomyState } {
  const produced = dailyProduction(state, dayEnd);
  const upkeep = dailyUpkeep(state.army);
  const r = state.resources;
  const foodAfter = r.food + produced.food - upkeep;
  const starving = foodAfter < 0;
  const maxCp = maxCommandPoints(castleLevelAt(state.buildings, dayEnd));
  const cpAfter = r.command_points >= maxCp ? r.command_points : r.command_points + 1;
  const next: Resources = {
    gold: r.gold + produced.gold,
    food: Math.max(0, foodAfter),
    knowledge: r.knowledge + produced.knowledge,
    influence: r.influence + produced.influence,
    command_points: cpAfter,
  };
  const morale = starving ? Math.max(20, state.morale - 10) : Math.min(100, state.morale + 5);
  const delta: Resources = {
    gold: next.gold - r.gold,
    food: next.food - r.food,
    knowledge: next.knowledge - r.knowledge,
    influence: next.influence - r.influence,
    command_points: next.command_points - r.command_points,
  };
  return { result: { day, produced, upkeep, starving, delta, morale }, state: { ...state, resources: next, morale } };
}
