import type { BuildingType } from "@/data/realm/buildings";
import type { Terrain, TerritoryOwner, TerritoryResource } from "@/data/realm/map";
import type { Tactic, UnitType } from "@/data/realm/units";
import type { Army } from "@/engine/realm/battle";

export interface BuildingView {
  id: string;
  type: BuildingType;
  level: number;
  status: "BUILDING" | "COMPLETED";
  completedAt: string;
}

export interface BuildOption {
  type: BuildingType;
  nextLevel: number;
  cost: { gold: number; food: number };
  minutes: number;
  allowed: boolean;
  reason: string | null;
}

export interface TerritoryView {
  code: string;
  name: string;
  owner: TerritoryOwner;
  faction: string | null;
  terrain: Terrain;
  resource: TerritoryResource;
  fortification: number;
  garrison: number;
  x: number;
  y: number;
  neighbors: string[];
  buildings: BuildingView[];
  /** Hero owns a neighbour and does not own this one. */
  attackable: boolean;
  buildOptions: BuildOption[];
}

export interface RecruitOption {
  type: UnitType;
  unitCost: { gold: number; food: number; knowledge: number; influence: number };
  maxAffordable: number;
  allowed: boolean;
  reason: string | null;
}

export interface BattleView {
  id: string;
  attacker: "HERO" | "RIVAL";
  defender: TerritoryOwner;
  territoryCode: string;
  territoryName: string;
  win: boolean;
  tactic: string | null;
  casualties: Army;
  rewards: { gold?: number; food?: number; influence?: number };
  attackerPower: number | null;
  defenderPower: number | null;
  at: string;
}

export interface KingdomScreen {
  kingdomName: string;
  resources: { gold: number; food: number; knowledge: number; influence: number; commandPoints: number };
  maxCommandPoints: number;
  castleLevel: number;
  production: { gold: number; food: number; knowledge: number; influence: number };
  upkeep: number;
  army: { units: Army; size: number; cap: number; power: number; morale: number };
  heroStrategy: number;
  construction: { type: BuildingType; level: number; territory: string; completedAt: string } | null;
  territories: TerritoryView[];
  recruitOptions: RecruitOption[];
  battles: BattleView[];
  pendingDays: number;
}

export interface AttackInput {
  territoryCode: string;
  tactic: Tactic;
  commander: "self" | "none";
}
