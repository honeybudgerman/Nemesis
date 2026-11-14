/**
 * Kael's own conquests (ТЗ §11.4): on his own seeded schedule, independent of
 * the player, he attacks a neutral or faction territory next to his lands.
 * In the MVP he does not attack the player's territories.
 */
import { TERRAIN_DEFENSE, TERRITORIES, type Terrain, type TerritoryOwner } from "@/data/realm/map";
import { createSeededRandom, hashString, pickOne } from "@/lib/random";

export interface WorldTerritory {
  code: string;
  owner: TerritoryOwner;
  terrain: Terrain;
  garrison: number;
  fortification: number;
  neighbors: string[];
}

export interface KaelCampaign {
  day: string;
  target: string;
  previousOwner: TerritoryOwner;
  win: boolean;
  kaelPower: number;
  defenderPower: number;
  garrisonAfter: number;
  fortificationAfter: number;
}

export const KAEL_CAMPAIGN_CHANCE = 0.1;

export function kaelPower(level: number): number {
  return 60 + 15 * level;
}

/** Garrison of Kael's original lands grows with his level. */
export function kaelHomeGarrison(code: string, level: number): number | null {
  const def = TERRITORIES.find((t) => t.code === code);
  if (!def || def.owner !== "RIVAL") return null;
  return def.garrison + 8 * Math.max(0, level - 1);
}

export function kaelCampaignDay(world: WorldTerritory[], day: string, rngSeed: number, kaelLevel: number): KaelCampaign | null {
  const rng = createSeededRandom(hashString(`campaign:v1:${rngSeed}:${day}`));
  if (rng() >= KAEL_CAMPAIGN_CHANCE) return null;
  const byCode = new Map(world.map((t) => [t.code, t]));
  const targets = world
    .filter((t) => (t.owner === "NEUTRAL" || t.owner === "FACTION") && t.neighbors.some((n) => byCode.get(n)?.owner === "RIVAL"))
    .sort((a, b) => a.code.localeCompare(b.code));
  if (targets.length === 0) return null;
  const target = pickOne(targets, rng);
  const att = kaelPower(kaelLevel) * (0.9 + 0.2 * rng());
  const def = target.garrison * (1 + 0.25 * target.fortification) * TERRAIN_DEFENSE[target.terrain] * (0.9 + 0.2 * rng());
  const win = att > def;
  return {
    day,
    target: target.code,
    previousOwner: target.owner,
    win,
    kaelPower: Math.round(att * 100) / 100,
    defenderPower: Math.round(def * 100) / 100,
    garrisonAfter: win ? 30 + 5 * kaelLevel : Math.max(5, Math.round(target.garrison * 0.85)),
    fortificationAfter: win ? Math.max(0, target.fortification - 1) : target.fortification,
  };
}
