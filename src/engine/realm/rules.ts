/**
 * What the player may build or recruit right now. Pure: used by the server to
 * price actions (the database re-checks every invariant) and by the screen.
 */
import { BUILDING_TYPES, BUILDINGS, buildingCost, buildingMinutes, maxLevelFor, type BuildingType } from "@/data/realm/buildings";
import { UNIT_TYPES, UNITS, type UnitType } from "@/data/realm/units";

export interface RulesBuilding {
  type: BuildingType;
  level: number;
  status: "BUILDING" | "COMPLETED";
  territoryCode: string;
}

export type Wallet = { gold: number; food: number; knowledge: number; influence: number };

/** Highest completed level of a type across the hero's lands. */
export function completedLevel(buildings: RulesBuilding[], type: BuildingType): number {
  return buildings.filter((b) => b.type === type).reduce((m, b) => Math.max(m, b.status === "COMPLETED" ? b.level : b.level - 1), 0);
}

export function buildOptionsFor(
  territoryCode: string,
  isCapital: boolean,
  buildings: RulesBuilding[],
  wallet: Wallet,
): { type: BuildingType; nextLevel: number; cost: { gold: number; food: number }; minutes: number; maxLevel: number; allowed: boolean; reason: string | null }[] {
  const castleLevel = Math.max(1, completedLevel(buildings, "castle"));
  const busy = buildings.some((b) => b.status === "BUILDING");
  return BUILDING_TYPES.filter((t) => isCapital || !BUILDINGS[t].capitalOnly).map((type) => {
    const here = buildings.find((b) => b.territoryCode === territoryCode && b.type === type);
    const nextLevel = (here?.level ?? 0) + 1;
    const maxLevel = maxLevelFor(type, castleLevel);
    const cost = buildingCost(type, nextLevel);
    let reason: string | null = null;
    if (busy) reason = "Уже идёт строительство";
    else if (nextLevel > BUILDINGS[type].maxLevel) reason = "Максимальный уровень";
    else if (nextLevel > maxLevel) reason = `Нужен замок ${nextLevel - 1} уровня`;
    else if (cost.gold > wallet.gold || cost.food > wallet.food) reason = "Не хватает ресурсов";
    return { type, nextLevel, cost, minutes: buildingMinutes(type, nextLevel), maxLevel, allowed: reason === null, reason };
  });
}

export function recruitOptionsFor(buildings: RulesBuilding[], wallet: Wallet, armySize: number, cap: number) {
  const levels = {
    barracks: completedLevel(buildings, "barracks"),
    academy: completedLevel(buildings, "academy"),
    castle: Math.max(1, completedLevel(buildings, "castle")),
  };
  return UNIT_TYPES.map((type: UnitType) => {
    const u = UNITS[type];
    const c = u.cost;
    const byRes = (Object.keys(c) as (keyof Wallet)[]).map((k) => (c[k] > 0 ? Math.floor(wallet[k] / c[k]) : Infinity));
    const maxAffordable = Math.max(0, Math.min(cap - armySize, ...byRes));
    let reason: string | null = null;
    if (levels.barracks < u.requires.barracks) reason = `Нужны казармы ${u.requires.barracks} уровня`;
    else if ((u.requires.academy ?? 0) > levels.academy) reason = `Нужна академия ${u.requires.academy} уровня`;
    else if ((u.requires.castle ?? 0) > levels.castle) reason = `Нужен замок ${u.requires.castle} уровня`;
    else if (armySize >= cap) reason = "Армия заполнена";
    else if (maxAffordable < 1) reason = "Не хватает ресурсов";
    return { type, unitCost: { ...c }, maxAffordable: Number.isFinite(maxAffordable) ? maxAffordable : 0, allowed: reason === null, reason };
  });
}
