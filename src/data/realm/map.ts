/**
 * The MVP world map (ТЗ §11.4): 12 territories on a 4×3 grid. Neighbours are
 * orthogonal grid cells. Each profile gets its own copy of this map in the DB.
 */
export type Terrain = "plains" | "forest" | "hills" | "mountains" | "river" | "coast";
export type TerritoryResource = "gold" | "food" | "knowledge" | "influence";
export type TerritoryOwner = "HERO" | "RIVAL" | "NEUTRAL" | "FACTION";

export const MAP_CODE = "realm_v1";

export interface TerritoryDef {
  code: string;
  name: string;
  x: number;
  y: number;
  terrain: Terrain;
  resource: TerritoryResource;
  owner: TerritoryOwner;
  faction?: string;
  garrison: number;
  fortification: number;
}

export const TERRITORIES: readonly TerritoryDef[] = [
  { code: "capital", name: "Столица", x: 0, y: 0, terrain: "plains", resource: "gold", owner: "HERO", garrison: 20, fortification: 1 },
  { code: "river_fords", name: "Речные броды", x: 1, y: 0, terrain: "river", resource: "food", owner: "NEUTRAL", garrison: 18, fortification: 0 },
  { code: "stone_hills", name: "Каменные холмы", x: 2, y: 0, terrain: "hills", resource: "gold", owner: "FACTION", faction: "Горные кланы", garrison: 55, fortification: 1 },
  { code: "iron_pass", name: "Железный перевал", x: 3, y: 0, terrain: "mountains", resource: "gold", owner: "FACTION", faction: "Горные кланы", garrison: 70, fortification: 2 },
  { code: "whisper_woods", name: "Шепчущий лес", x: 0, y: 1, terrain: "forest", resource: "knowledge", owner: "NEUTRAL", garrison: 22, fortification: 0 },
  { code: "amber_fields", name: "Янтарные поля", x: 1, y: 1, terrain: "plains", resource: "food", owner: "NEUTRAL", garrison: 30, fortification: 0 },
  { code: "old_monastery", name: "Старый монастырь", x: 2, y: 1, terrain: "hills", resource: "knowledge", owner: "FACTION", faction: "Орден Пепла", garrison: 60, fortification: 2 },
  { code: "black_watch", name: "Чёрная застава", x: 3, y: 1, terrain: "hills", resource: "gold", owner: "RIVAL", garrison: 60, fortification: 2 },
  { code: "salt_coast", name: "Соляной берег", x: 0, y: 2, terrain: "coast", resource: "gold", owner: "NEUTRAL", garrison: 25, fortification: 0 },
  { code: "misty_marsh", name: "Туманные топи", x: 1, y: 2, terrain: "river", resource: "influence", owner: "NEUTRAL", garrison: 35, fortification: 1 },
  { code: "merchant_port", name: "Торговый порт", x: 2, y: 2, terrain: "coast", resource: "influence", owner: "FACTION", faction: "Вольные купцы", garrison: 50, fortification: 1 },
  { code: "black_reach", name: "Чёрный Предел", x: 3, y: 2, terrain: "mountains", resource: "influence", owner: "RIVAL", garrison: 110, fortification: 3 },
];

export const HOME_TERRITORY = "capital";
export const RIVAL_HOME_TERRITORY = "black_reach";

export function neighboursOf(code: string): string[] {
  const t = TERRITORIES.find((x) => x.code === code);
  if (!t) return [];
  return TERRITORIES.filter((o) => Math.abs(o.x - t.x) + Math.abs(o.y - t.y) === 1).map((o) => o.code);
}

export const TERRAIN_LABELS: Readonly<Record<Terrain, string>> = {
  plains: "Равнины",
  forest: "Лес",
  hills: "Холмы",
  mountains: "Горы",
  river: "Река",
  coast: "Побережье",
};

/** Defender bonus by terrain (ТЗ §11.2, TerrainModifier). */
export const TERRAIN_DEFENSE: Readonly<Record<Terrain, number>> = {
  plains: 1.0,
  forest: 1.1,
  hills: 1.2,
  mountains: 1.35,
  river: 1.15,
  coast: 1.05,
};
