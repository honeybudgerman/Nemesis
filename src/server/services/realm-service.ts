import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BUILDINGS, maxLevelFor, buildingCost, buildingMinutes, type BuildingType } from "@/data/realm/buildings";
import { HOME_TERRITORY, MAP_CODE, neighboursOf, TERRITORIES, type Terrain, type TerritoryOwner, type TerritoryResource } from "@/data/realm/map";
import { maxArmySize, STARTING_ARMY, UNIT_TYPES, UNITS, type Tactic, type UnitType } from "@/data/realm/units";
import { SIMULATION_BATCH_DAYS, SIMULATION_MAX_BATCHES_PER_REQUEST } from "@/data/rival/kael";
import { armyPower, armySize, resolveBattle, type Army, type BattleResult } from "@/engine/realm/battle";
import type { WorldTerritory } from "@/engine/realm/campaign";
import { castleLevelAt, dailyProduction, dailyUpkeep, maxCommandPoints, type EconomyState } from "@/engine/realm/economy";
import { buildOptionsFor, completedLevel, recruitOptionsFor, type RulesBuilding } from "@/engine/realm/rules";
import { simulateWorldBatch } from "@/engine/realm/world";
import { countPendingDays } from "@/engine/simulation/rival";
import { hashString } from "@/lib/random";
import { addDays, parseLocalDate, questPeriods, startOfLocalDay } from "@/lib/time";
import { ApiError, fromDbError } from "@/server/http/errors";
import { getAdminSupabase } from "@/server/supabase/admin";
import { ensureRival } from "@/server/services/rival-service";
import type { BattleView, KingdomScreen, TerritoryView } from "@/types/realm";

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getAdminSupabase().rpc(fn, args);
  if (error) throw fromDbError(error);
  return data as T;
}

const num = (v: number | string | null | undefined) => (v == null ? 0 : Number(v));

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------
interface TerritoryRow {
  id: string;
  territory_code: string;
  name: string;
  owner_type: TerritoryOwner;
  faction_name: string | null;
  terrain_type: Terrain;
  resource_type: TerritoryResource;
  fortification_level: number;
  garrison_strength: number;
  pos_x: number;
  pos_y: number;
  neighbors: string[];
}
interface BuildingRow {
  id: string;
  territory_id: string;
  building_type: BuildingType;
  level: number;
  construction_status: "BUILDING" | "COMPLETED";
  completed_at: string;
}

interface Realm {
  profileId: string;
  timezone: string;
  kingdom: {
    id: string;
    name: string;
    gold: number;
    food: number;
    knowledge: number;
    influence: number;
    commandPoints: number;
    lastEconomyDay: string | null;
  };
  territories: TerritoryRow[];
  buildings: (BuildingRow & { territoryCode: string; terrain: Terrain })[];
  army: Army;
  morale: number;
  strategy: number;
  rival: { rngSeed: number; level: number } | null;
}

async function loadProfile(db: SupabaseClient, userId: string) {
  const p = await db
    .from("game_profiles")
    .select("id, users(timezone)")
    .eq("user_id", userId)
    .maybeSingle<{ id: string; users: { timezone: string } | null }>();
  if (p.error) throw fromDbError(p.error);
  if (!p.data) throw new ApiError("PROFILE_NOT_FOUND");
  return { profileId: p.data.id, timezone: p.data.users?.timezone ?? "UTC" };
}

async function loadRealm(db: SupabaseClient, profileId: string, timezone: string): Promise<Realm | null> {
  const [k, terr, rival, stats] = await Promise.all([
    db
      .from("kingdoms")
      .select("id, name, gold, food, knowledge, influence, command_points, last_economy_day")
      .eq("game_profile_id", profileId)
      .eq("owner_type", "HERO")
      .maybeSingle(),
    db.from("territories").select("*").eq("game_profile_id", profileId).order("pos_y").order("pos_x"),
    db.from("rival_profiles").select("rng_seed, level").eq("game_profile_id", profileId).maybeSingle(),
    db.from("character_stats").select("strategy").eq("game_profile_id", profileId).eq("character_type", "HERO").maybeSingle(),
  ]);
  for (const x of [k, terr, rival, stats]) if (x.error) throw fromDbError(x.error);
  if (!k.data) throw new ApiError("KINGDOM_NOT_FOUND");
  const territories = (terr.data ?? []) as TerritoryRow[];
  if (territories.length === 0) return null;

  const [b, a] = await Promise.all([
    db.from("buildings").select("id, territory_id, building_type, level, construction_status, completed_at").eq("kingdom_id", k.data.id),
    db.from("armies").select("id, morale, army_units(unit_type, quantity)").eq("kingdom_id", k.data.id).maybeSingle(),
  ]);
  if (b.error) throw fromDbError(b.error);
  if (a.error) throw fromDbError(a.error);
  const byId = new Map(territories.map((t) => [t.id, t]));
  const army: Army = {};
  for (const u of ((a.data?.army_units ?? []) as { unit_type: UnitType; quantity: number }[])) if (u.quantity > 0) army[u.unit_type] = u.quantity;

  return {
    profileId,
    timezone,
    kingdom: {
      id: k.data.id,
      name: k.data.name,
      gold: num(k.data.gold),
      food: num(k.data.food),
      knowledge: num(k.data.knowledge),
      influence: num(k.data.influence),
      commandPoints: num(k.data.command_points),
      lastEconomyDay: k.data.last_economy_day,
    },
    territories,
    buildings: ((b.data ?? []) as BuildingRow[])
      .filter((x) => byId.has(x.territory_id))
      .map((x) => ({ ...x, territoryCode: byId.get(x.territory_id)!.territory_code, terrain: byId.get(x.territory_id)!.terrain_type })),
    army,
    morale: a.data?.morale ?? 80,
    strategy: stats.data?.strategy ?? 10,
    rival: rival.data ? { rngSeed: num(rival.data.rng_seed), level: rival.data.level } : null,
  };
}

/** Create the map copy, castle and starting army (also for profiles from earlier sprints). */
async function ensureRealm(db: SupabaseClient, userId: string, profileId: string, timezone: string): Promise<Realm> {
  let realm = await loadRealm(db, profileId, timezone);
  if (realm) return realm;
  const today = questPeriods(new Date(), timezone).today;
  await ensureRival(userId, today); // Kael's lands need his kingdom
  await rpc("ensure_realm", {
    p_user_id: userId,
    p_map_code: MAP_CODE,
    p_map: TERRITORIES.map((t) => ({ ...t, faction: t.faction ?? null, neighbors: neighboursOf(t.code) })),
    p_start_day: today,
    p_army: STARTING_ARMY,
    p_morale: 80,
  });
  realm = await loadRealm(db, profileId, timezone);
  if (!realm) throw new ApiError("KINGDOM_NOT_FOUND");
  return realm;
}

function economyOf(r: Realm): EconomyState {
  return {
    resources: { gold: r.kingdom.gold, food: r.kingdom.food, knowledge: r.kingdom.knowledge, influence: r.kingdom.influence, command_points: r.kingdom.commandPoints },
    morale: r.morale,
    buildings: r.buildings.map((b) => ({ type: b.building_type, level: b.level, terrain: b.terrain, completedAt: b.completed_at })),
    territories: r.territories.filter((t) => t.owner_type === "HERO").map((t) => ({ resource: t.resource_type })),
    army: r.army,
  };
}

function worldOf(r: Realm): WorldTerritory[] {
  return r.territories.map((t) => ({
    code: t.territory_code,
    owner: t.owner_type,
    terrain: t.terrain_type,
    garrison: t.garrison_strength,
    fortification: t.fortification_level,
    neighbors: t.neighbors,
  }));
}

// ---------------------------------------------------------------------------
// World tick: economy days + Kael's campaigns, bounded batches (ТЗ §7.6, §18)
// ---------------------------------------------------------------------------
export async function syncWorld(
  db: SupabaseClient,
  userId: string,
  maxBatches = SIMULATION_MAX_BATCHES_PER_REQUEST,
): Promise<{ realm: Realm; pendingDays: number }> {
  const { profileId, timezone } = await loadProfile(db, userId);
  let realm = await ensureRealm(db, userId, profileId, timezone);
  const today = questPeriods(new Date(), timezone).today;
  const dayEnd = (day: string) => startOfLocalDay(addDays(parseLocalDate(day), 1), timezone);

  for (let i = 0; i < maxBatches; i++) {
    const last = realm.kingdom.lastEconomyDay ?? questPeriods(new Date(), timezone).today;
    const before = worldOf(realm);
    const b = simulateWorldBatch(economyOf(realm), before, realm.rival, last, today, dayEnd, SIMULATION_BATCH_DAYS);
    if (b.days.length === 0) break;
    const changed = b.world.filter((t) => {
      const o = before.find((x) => x.code === t.code)!;
      return o.owner !== "HERO" && (o.owner !== t.owner || o.garrison !== t.garrison || o.fortification !== t.fortification);
    });
    await rpc("apply_world_days", {
      p_user_id: userId,
      p_expected_last_day: last,
      p_payload: {
        last_day: b.lastDay,
        totals: b.totals,
        morale: b.economy.morale,
        territories: changed.map((t) => ({ code: t.code, owner: t.owner, garrison: t.garrison, fortification: t.fortification })),
        campaigns: b.campaigns.map((c) => ({
          day: c.day,
          target: c.target,
          previous_owner: c.previousOwner,
          win: c.win,
          kael_power: c.kaelPower,
          defender_power: c.defenderPower,
          garrison_after: c.garrisonAfter,
        })),
      },
    });
    // "stale" means another request advanced the world; reloading is enough either way.
    realm = (await loadRealm(db, profileId, timezone))!;
  }
  const pendingDays = realm.kingdom.lastEconomyDay ? countPendingDays(realm.kingdom.lastEconomyDay, today) : 0;
  return { realm, pendingDays };
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------
function rulesBuildings(r: Realm): RulesBuilding[] {
  const now = Date.now();
  return r.buildings
    .filter((b) => r.territories.find((t) => t.territory_code === b.territoryCode)?.owner_type === "HERO")
    .map((b) => ({
      type: b.building_type,
      level: b.level,
      status: b.construction_status === "BUILDING" && Date.parse(b.completed_at) > now ? "BUILDING" : "COMPLETED",
      territoryCode: b.territoryCode,
    }));
}

const wallet = (r: Realm) => ({ gold: r.kingdom.gold, food: r.kingdom.food, knowledge: r.kingdom.knowledge, influence: r.kingdom.influence });

async function loadBattles(db: SupabaseClient, r: Realm): Promise<BattleView[]> {
  const { data, error } = await db
    .from("battles")
    .select("id, attacker_side, defender_side, territory_code, result, tactic, casualties, rewards, attacker_snapshot, defender_snapshot, resolved_at, simulation_day")
    .eq("game_profile_id", r.profileId)
    .order("resolved_at", { ascending: false })
    .limit(10);
  if (error) throw fromDbError(error);
  const names = new Map(r.territories.map((t) => [t.territory_code, t.name]));
  return (data ?? []).map((b) => ({
    id: b.id,
    attacker: b.attacker_side,
    defender: b.defender_side,
    territoryCode: b.territory_code,
    territoryName: names.get(b.territory_code) ?? b.territory_code,
    win: b.result === "ATTACKER_WON",
    tactic: b.tactic,
    casualties: (b.casualties ?? {}) as Army,
    rewards: (b.rewards ?? {}) as BattleView["rewards"],
    attackerPower: b.attacker_snapshot?.power != null ? Number(b.attacker_snapshot.power) : null,
    defenderPower: b.defender_snapshot?.power != null ? Number(b.defender_snapshot.power) : null,
    at: b.simulation_day ?? b.resolved_at,
  }));
}

async function screen(db: SupabaseClient, r: Realm, pendingDays: number): Promise<KingdomScreen> {
  const now = new Date();
  const rb = rulesBuildings(r);
  const castleLevel = Math.max(1, completedLevel(rb, "castle"));
  const barracks = completedLevel(rb, "barracks");
  const cap = maxArmySize(castleLevel, barracks);
  const size = armySize(r.army);
  const eco = economyOf(r);
  const heroCodes = new Set(r.territories.filter((t) => t.owner_type === "HERO").map((t) => t.territory_code));
  const building = r.buildings.find((b) => b.construction_status === "BUILDING" && Date.parse(b.completed_at) > now.getTime());

  const territories: TerritoryView[] = r.territories.map((t) => {
    const isHero = t.owner_type === "HERO";
    return {
      code: t.territory_code,
      name: t.name,
      owner: t.owner_type,
      faction: t.faction_name,
      terrain: t.terrain_type,
      resource: t.resource_type,
      fortification: t.fortification_level,
      garrison: t.garrison_strength,
      x: t.pos_x,
      y: t.pos_y,
      neighbors: t.neighbors,
      buildings: r.buildings
        .filter((b) => b.territoryCode === t.territory_code)
        .map((b) => ({
          id: b.id,
          type: b.building_type,
          level: b.level,
          status: b.construction_status === "BUILDING" && Date.parse(b.completed_at) > now.getTime() ? "BUILDING" : "COMPLETED",
          completedAt: b.completed_at,
        })),
      attackable: !isHero && t.neighbors.some((n) => heroCodes.has(n)),
      buildOptions: isHero
        ? buildOptionsFor(t.territory_code, t.territory_code === HOME_TERRITORY, rb, wallet(r)).map((o) => ({
            type: o.type,
            nextLevel: o.nextLevel,
            cost: o.cost,
            minutes: o.minutes,
            allowed: o.allowed,
            reason: o.reason,
          }))
        : [],
    };
  });

  return {
    kingdomName: r.kingdom.name,
    resources: { ...wallet(r), commandPoints: r.kingdom.commandPoints },
    maxCommandPoints: maxCommandPoints(castleLevelAt(eco.buildings, now)),
    castleLevel,
    production: dailyProduction(eco, now),
    upkeep: dailyUpkeep(r.army),
    army: { units: r.army, size, cap, power: Math.round(armyPower(r.army)), morale: r.morale },
    heroStrategy: r.strategy,
    construction: building
      ? { type: building.building_type, level: building.level, territory: r.territories.find((t) => t.id === building.territory_id)?.name ?? "", completedAt: building.completed_at }
      : null,
    territories,
    recruitOptions: recruitOptionsFor(rb, wallet(r), size, cap),
    battles: await loadBattles(db, r),
    pendingDays,
  };
}

export async function getKingdomScreen(db: SupabaseClient, userId: string): Promise<KingdomScreen> {
  const { realm, pendingDays } = await syncWorld(db, userId);
  return screen(db, realm, pendingDays);
}

// ---------------------------------------------------------------------------
// Actions (server prices them; the database re-checks every invariant)
// ---------------------------------------------------------------------------
export async function build(
  db: SupabaseClient,
  userId: string,
  input: { territoryCode: string; buildingType: BuildingType; idempotencyKey: string },
): Promise<{ status: string; screen: KingdomScreen }> {
  const { realm } = await syncWorld(db, userId, 1);
  const t = realm.territories.find((x) => x.territory_code === input.territoryCode);
  if (!t || t.owner_type !== "HERO") throw new ApiError("TERRITORY_NOT_OWNED");
  const def = BUILDINGS[input.buildingType];
  if (def.capitalOnly && input.territoryCode !== HOME_TERRITORY) throw new ApiError("VALIDATION_ERROR", "Эту постройку можно возвести только в столице.");
  const rb = rulesBuildings(realm);
  const here = realm.buildings.find((b) => b.territoryCode === input.territoryCode && b.building_type === input.buildingType);
  const level = (here?.level ?? 0) + 1;
  const castleLevel = Math.max(1, completedLevel(rb, "castle"));
  const r = await rpc<{ status: string }>("start_building", {
    p_user_id: userId,
    p_key: input.idempotencyKey,
    p_territory_code: input.territoryCode,
    p_type: input.buildingType,
    p_level: level,
    p_max_level: Math.min(def.maxLevel, maxLevelFor(input.buildingType, castleLevel)),
    p_capital_only: Boolean(def.capitalOnly),
    p_cost: buildingCost(input.buildingType, level),
    p_minutes: buildingMinutes(input.buildingType, level),
  });
  const fresh = await syncWorld(db, userId, 0);
  return { status: r.status, screen: await screen(db, fresh.realm, fresh.pendingDays) };
}

export async function recruit(
  db: SupabaseClient,
  userId: string,
  input: { unitType: UnitType; quantity: number; idempotencyKey: string },
): Promise<{ status: string; screen: KingdomScreen }> {
  const { realm } = await syncWorld(db, userId, 1);
  const rb = rulesBuildings(realm);
  const u = UNITS[input.unitType];
  const castleLevel = Math.max(1, completedLevel(rb, "castle"));
  const cost = Object.fromEntries(Object.entries(u.cost).map(([k, v]) => [k, v * input.quantity]));
  const r = await rpc<{ status: string }>("recruit_units", {
    p_user_id: userId,
    p_key: input.idempotencyKey,
    p_unit_type: input.unitType,
    p_tier: u.tier,
    p_quantity: input.quantity,
    p_cost: cost,
    p_requires: { barracks: u.requires.barracks, academy: u.requires.academy ?? 0, castle: u.requires.castle ?? 0 },
    p_max_army: maxArmySize(castleLevel, completedLevel(rb, "barracks")),
  });
  const fresh = await syncWorld(db, userId, 0);
  return { status: r.status, screen: await screen(db, fresh.realm, fresh.pendingDays) };
}

export interface AttackOutcome {
  status: "resolved" | "duplicate";
  battle: (BattleResult & { territoryName: string; tactic: Tactic }) | null;
  screen: KingdomScreen;
}

export async function attack(
  db: SupabaseClient,
  userId: string,
  input: { territoryCode: string; tactic: Tactic; commander: "self" | "none"; idempotencyKey: string },
): Promise<AttackOutcome> {
  let { realm } = await syncWorld(db, userId, 1);
  for (let attempt = 0; attempt < 3; attempt++) {
    const t = realm.territories.find((x) => x.territory_code === input.territoryCode);
    if (!t) throw new ApiError("VALIDATION_ERROR", "Неизвестная территория.");
    const seed = hashString(`battle:${realm.profileId}:${input.idempotencyKey}`);
    const result = resolveBattle({
      army: realm.army,
      morale: realm.morale,
      commander: input.commander,
      strategy: realm.strategy,
      tactic: input.tactic,
      target: { terrain: t.terrain_type, garrison: t.garrison_strength, fortification: t.fortification_level, resource: t.resource_type },
      seed,
    });
    const expectedArmy = Object.fromEntries(UNIT_TYPES.filter((u) => (realm.army[u] ?? 0) > 0).map((u) => [u, realm.army[u]]));
    const r = await rpc<{ status: "resolved" | "duplicate" | "stale" }>("resolve_battle", {
      p_user_id: userId,
      p_key: input.idempotencyKey,
      p_territory_code: input.territoryCode,
      p_expected_army: expectedArmy,
      p_expected_garrison: t.garrison_strength,
      p_battle: {
        win: result.win,
        casualties: result.casualties,
        garrison_after: result.garrisonAfter,
        fortification_after: result.fortificationAfter,
        rewards: result.rewards,
        morale_after: result.moraleAfter,
        seed,
        tactic: input.tactic,
        attacker_snapshot: { army: expectedArmy, morale: realm.morale, commander: input.commander, power: result.attackerPower },
        defender_snapshot: { garrison: t.garrison_strength, fortification: t.fortification_level, terrain: t.terrain_type, power: result.defenderPower },
      },
    });
    if (r.status === "stale") {
      realm = (await syncWorld(db, userId, 0)).realm;
      continue;
    }
    const fresh = await syncWorld(db, userId, 0);
    return {
      status: r.status,
      battle: r.status === "resolved" ? { ...result, territoryName: t.name, tactic: input.tactic } : null,
      screen: await screen(db, fresh.realm, fresh.pendingDays),
    };
  }
  throw new ApiError("RATE_LIMITED", "Состояние армии меняется слишком быстро. Повторите попытку.");
}
