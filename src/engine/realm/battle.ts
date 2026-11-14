/**
 * Simplified battle model (ТЗ §11.2). Pure and seeded: the same inputs and
 * seed always give the same result, so the server can recompute and tests can
 * replay it. Battles never award XP: XP comes only from real-life quests.
 */
import { TERRAIN_DEFENSE, type Terrain, type TerritoryResource } from "@/data/realm/map";
import { TACTICS, TIER_MODIFIER, UNIT_TYPES, UNITS, unitPower, type Tactic, type UnitType } from "@/data/realm/units";
import { createSeededRandom, type Rng } from "@/lib/random";

export type Army = Partial<Record<UnitType, number>>;
/** "self": the ruler (Strategy stat); "general": the appointed court commander (military skill). */
export type Commander = "self" | "none" | "general";

export interface BattleInput {
  army: Army;
  morale: number;
  commander: Commander;
  /** Hero's strategy stat 0..100 (used when the ruler leads in person). */
  strategy: number;
  tactic: Tactic;
  target: { terrain: Terrain; garrison: number; fortification: number; resource: TerritoryResource };
  seed: number;
}

export interface BattleResult {
  win: boolean;
  attackerBase: number;
  attackerPower: number;
  defenderPower: number;
  attackerRandom: number;
  defenderRandom: number;
  casualties: Army;
  survivors: Army;
  /** Garrison left in the territory after the battle. */
  garrisonAfter: number;
  fortificationAfter: number;
  rewards: { gold: number; food: number; influence: number };
  moraleAfter: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round2 = (v: number) => Math.round(v * 100) / 100;

export function armyPower(army: Army): number {
  let p = 0;
  for (const t of UNIT_TYPES) p += (army[t] ?? 0) * unitPower(t) * TIER_MODIFIER[UNITS[t].tier];
  return p;
}

export function armySize(army: Army): number {
  return UNIT_TYPES.reduce((s, t) => s + (army[t] ?? 0), 0);
}

export function moraleModifier(morale: number): number {
  return 0.5 + clamp(morale, 0, 100) / 200;
}

export function commanderModifier(c: Commander, strategy: number): number {
  return c === "none" ? 1 : 1 + clamp(strategy, 0, 100) / 200;
}

/** Defensive strength before the random roll: garrison × fortifications × terrain. */
export function defenderBase(t: BattleInput["target"]): number {
  return t.garrison * (1 + 0.25 * t.fortification) * TERRAIN_DEFENSE[t.terrain];
}

export function attackerBasePower(i: Pick<BattleInput, "army" | "morale" | "commander" | "strategy" | "tactic">): number {
  return armyPower(i.army) * moraleModifier(i.morale) * commanderModifier(i.commander, i.strategy) * TACTICS[i.tactic].power;
}

const roll = (rng: Rng) => 0.9 + 0.2 * rng(); // RandomModifier 0.90–1.10

export function resolveBattle(i: BattleInput): BattleResult {
  const rng = createSeededRandom(i.seed);
  const base = attackerBasePower(i);
  const ar = roll(rng);
  const dr = roll(rng);
  const att = base * ar;
  const def = defenderBase(i.target) * dr;
  const win = att > def && base > 0;
  const ratio = att > 0 ? def / att : 10;
  const lossMul = TACTICS[i.tactic].losses;
  const frac = clamp((win ? clamp(0.35 * ratio, 0.03, 0.6) : clamp(0.25 + 0.35 * ratio, 0.2, 0.85)) * lossMul, 0, 0.95);

  const casualties: Army = {};
  const survivors: Army = {};
  for (const t of UNIT_TYPES) {
    const n = i.army[t] ?? 0;
    if (n <= 0) continue;
    const lost = Math.min(n, Math.round(n * frac));
    if (lost > 0) casualties[t] = lost;
    survivors[t] = n - lost;
  }

  const fort = i.target.fortification;
  const rewards = win
    ? {
        gold: 30 + 15 * fort + (i.target.resource === "gold" ? 20 : 0),
        food: i.target.resource === "food" ? 30 : 0,
        influence: 3 + fort,
      }
    : { gold: 0, food: 0, influence: 0 };

  return {
    win,
    attackerBase: round2(base),
    attackerPower: round2(att),
    defenderPower: round2(def),
    attackerRandom: round2(ar),
    defenderRandom: round2(dr),
    casualties,
    survivors,
    garrisonAfter: win ? 10 : Math.max(1, Math.round(i.target.garrison * (1 - clamp((0.3 * att) / Math.max(def, 1), 0.05, 0.5)))),
    fortificationAfter: win ? Math.max(0, fort - 1) : fort,
    rewards,
    moraleAfter: clamp(i.morale + (win ? 5 : -10), 0, 100),
  };
}

export interface RiskEstimate {
  winChance: number;
  level: "low" | "medium" | "high";
  attackerPower: number;
  defenderPower: number;
}

/** Preliminary risk (ТЗ §11.3): win chance over the random range, without the actual seed. */
export function estimateRisk(i: Omit<BattleInput, "seed">): RiskEstimate {
  const base = attackerBasePower(i);
  const def = defenderBase(i.target);
  // Exact for two independent uniforms on [0.9, 1.1]: P(base·a > def·d), sampled on a fine grid.
  const N = 40;
  let wins = 0;
  for (let a = 0; a < N; a++) {
    for (let d = 0; d < N; d++) {
      const ar = 0.9 + (0.2 * (a + 0.5)) / N;
      const dr = 0.9 + (0.2 * (d + 0.5)) / N;
      if (base * ar > def * dr) wins++;
    }
  }
  const winChance = base > 0 ? wins / (N * N) : 0;
  return {
    winChance: round2(winChance),
    level: winChance >= 0.75 ? "low" : winChance >= 0.35 ? "medium" : "high",
    attackerPower: round2(base),
    defenderPower: round2(def),
  };
}
