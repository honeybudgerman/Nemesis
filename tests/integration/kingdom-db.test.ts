import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STARTING_HERO_STATS, STARTING_RESOURCES } from "@/data/kingdom";
import { buildingCost } from "@/data/realm/buildings";
import { MAP_CODE, neighboursOf, TERRITORIES, type Terrain } from "@/data/realm/map";
import { STARTING_ARMY } from "@/data/realm/units";
import { KAEL, KAEL_STARTING_STATS, SIMULATION_VERSION } from "@/data/rival/kael";
import { SKILL_CODES } from "@/data/skills";
import { resolveBattle } from "@/engine/realm/battle";
import type { WorldTerritory } from "@/engine/realm/campaign";
import type { EconomyState } from "@/engine/realm/economy";
import { simulateWorldBatch } from "@/engine/realm/world";
import { addDays, formatLocalDate, parseLocalDate } from "@/lib/time";
import { createTestDatabase, serviceClient, TEST_DATABASE_URL, userClient } from "./db";

const run = TEST_DATABASE_URL ? describe : describe.skip;
const shift = (d: string, n: number) => formatLocalDate(addDays(parseLocalDate(d), n));
const dayEnd = (d: string) => new Date(`${shift(d, 1)}T00:00:00Z`);

run("database: kingdom, army, battles", () => {
  let url = "";
  let drop: () => Promise<void> = async () => {};
  let svc: Client;

  beforeAll(async () => {
    const db = await createTestDatabase();
    url = db.url;
    drop = db.drop;
    svc = await serviceClient(url);
  });

  afterAll(async () => {
    await svc?.end();
    await drop();
  });

  async function newPlayer(startDay = "2026-11-15") {
    const userId = randomUUID();
    const c = await serviceClient(url);
    await c.query("reset role");
    await c.query("insert into auth.users (id, email) values ($1, $2)", [userId, `${userId}@test.local`]);
    await c.end();
    const { rows } = await svc.query("select public.start_game($1,$2,$3,$4,$5,$6,$7,$8,$9) as r", [
      userId, "Игорь", "UTC", 55, "Арен", "Северная марка", [...SKILL_CODES],
      JSON.stringify(STARTING_RESOURCES), JSON.stringify(STARTING_HERO_STATS),
    ]);
    await svc.query("select public.ensure_rival($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [
      userId, KAEL.name, KAEL.kingdomName,
      JSON.stringify({ discipline: KAEL.disciplineFactor, learning: 1, risk: KAEL.riskTolerance, dailyMinutes: 45 }),
      4242, SIMULATION_VERSION, startDay, [...SKILL_CODES], JSON.stringify(KAEL_STARTING_STATS), JSON.stringify(STARTING_RESOURCES),
    ]);
    const realm = await ensureRealm(userId, startDay);
    return { userId, profileId: rows[0].r.profile_id as string, realm };
  }

  async function ensureRealm(userId: string, startDay: string) {
    const { rows } = await svc.query("select public.ensure_realm($1, $2, $3, $4, $5, 80) as r", [
      userId, MAP_CODE, JSON.stringify(TERRITORIES.map((t) => ({ ...t, faction: t.faction ?? null, neighbors: neighboursOf(t.code) }))),
      startDay, JSON.stringify(STARTING_ARMY),
    ]);
    return rows[0].r as { created: boolean };
  }

  async function kingdom(profileId: string) {
    const { rows } = await svc.query(
      "select id, gold::int, food::int, knowledge::int, influence::int, command_points, to_char(last_economy_day, 'YYYY-MM-DD') as last_day from kingdoms where game_profile_id = $1 and owner_type = 'HERO'",
      [profileId],
    );
    return rows[0] as { id: string; gold: number; food: number; knowledge: number; influence: number; command_points: number; last_day: string };
  }

  async function army(profileId: string): Promise<Record<string, number>> {
    const { rows } = await svc.query(
      "select public.nemesis_army_json(a.id) as j from armies a join kingdoms k on k.id = a.kingdom_id where k.game_profile_id = $1 and k.owner_type = 'HERO'",
      [profileId],
    );
    return rows[0].j;
  }

  async function territories(profileId: string) {
    const { rows } = await svc.query("select * from territories where game_profile_id = $1 order by territory_code", [profileId]);
    return rows as { territory_code: string; owner_type: WorldTerritory["owner"]; terrain_type: Terrain; garrison_strength: number; fortification_level: number; neighbors: string[]; resource_type: "gold" | "food" | "knowledge" | "influence" }[];
  }

  async function engineState(profileId: string): Promise<{ eco: EconomyState; world: WorldTerritory[] }> {
    const k = await kingdom(profileId);
    const t = await territories(profileId);
    const { rows: b } = await svc.query(
      "select b.building_type as type, b.level, t.terrain_type as terrain, b.completed_at from buildings b join territories t on t.id = b.territory_id where b.kingdom_id = $1",
      [k.id],
    );
    const { rows: m } = await svc.query("select morale from armies where kingdom_id = $1", [k.id]);
    return {
      eco: {
        resources: { gold: k.gold, food: k.food, knowledge: k.knowledge, influence: k.influence, command_points: k.command_points },
        morale: m[0].morale,
        buildings: b.map((x) => ({ type: x.type, level: x.level, terrain: x.terrain, completedAt: new Date(x.completed_at).toISOString() })),
        territories: t.filter((x) => x.owner_type === "HERO").map((x) => ({ resource: x.resource_type })),
        army: await army(profileId),
      },
      world: t.map((x) => ({ code: x.territory_code, owner: x.owner_type, terrain: x.terrain_type, garrison: x.garrison_strength, fortification: x.fortification_level, neighbors: x.neighbors })),
    };
  }

  const applyWorld = (userId: string, expected: string, payload: unknown) =>
    svc.query("select public.apply_world_days($1, $2, $3) as r", [userId, expected, JSON.stringify(payload)]).then((r) => r.rows[0].r as { status: string });

  async function catchUp(userId: string, profileId: string, today: string) {
    let batches = 0;
    for (;;) {
      const k = await kingdom(profileId);
      const { eco, world } = await engineState(profileId);
      const b = simulateWorldBatch(eco, world, { rngSeed: 4242, level: 1 }, k.last_day, today, dayEnd, 31);
      if (b.days.length === 0) return batches;
      const changed = b.world.filter((t) => {
        const o = world.find((x) => x.code === t.code)!;
        return o.owner !== t.owner || o.garrison !== t.garrison || o.fortification !== t.fortification;
      });
      const r = await applyWorld(userId, k.last_day, {
        last_day: b.lastDay,
        totals: b.totals,
        morale: b.economy.morale,
        territories: changed.map((t) => ({ code: t.code, owner: t.owner, garrison: t.garrison, fortification: t.fortification })),
        campaigns: b.campaigns.map((c) => ({ day: c.day, target: c.target, previous_owner: c.previousOwner, win: c.win, kael_power: c.kaelPower, defender_power: c.defenderPower, garrison_after: c.garrisonAfter })),
      });
      expect(r.status).toBe("applied");
      batches++;
    }
  }

  const build = (userId: string, key: string, code: string, type: string, level: number, maxLevel = 2, capitalOnly = false) =>
    svc
      .query("select public.start_building($1,$2,$3,$4,$5,$6,$7,$8,$9) as r", [userId, key, code, type, level, maxLevel, capitalOnly, JSON.stringify(buildingCost(type as never, level)), 30])
      .then((r) => r.rows[0].r as { status: string });

  const finishConstruction = (profileId: string) =>
    svc.query("update buildings set completed_at = now() - interval '1 minute' where kingdom_id = (select id from kingdoms where game_profile_id = $1 and owner_type = 'HERO')", [profileId]);

  const recruit = (userId: string, key: string, type: string, qty: number, unitGold: number, maxArmy = 30) =>
    svc
      .query("select public.recruit_units($1,$2,$3,1,$4,$5,$6,$7) as r", [userId, key, type, qty, JSON.stringify({ gold: unitGold * qty, food: 5 * qty }), JSON.stringify({ barracks: 1 }), maxArmy])
      .then((r) => r.rows[0].r as { status: string });

  async function attack(userId: string, profileId: string, key: string, code: string, client: Client = svc) {
    const t = (await territories(profileId)).find((x) => x.territory_code === code)!;
    const a = await army(profileId);
    const res = resolveBattle({
      army: a, morale: 80, commander: "self", strategy: 10, tactic: "balanced",
      target: { terrain: t.terrain_type, garrison: t.garrison_strength, fortification: t.fortification_level, resource: t.resource_type }, seed: 7,
    });
    const r = await client.query("select public.resolve_battle($1,$2,$3,$4,$5,$6) as r", [
      userId, key, code, JSON.stringify(a), t.garrison_strength,
      JSON.stringify({ win: res.win, casualties: res.casualties, garrison_after: res.garrisonAfter, fortification_after: res.fortificationAfter, rewards: res.rewards, morale_after: res.moraleAfter, seed: 7, tactic: "balanced" }),
    ]);
    return { r: r.rows[0].r as { status: string; win?: boolean }, res };
  }

  it("ensure_realm creates the map, castle and starting army once", async () => {
    const { userId, profileId, realm } = await newPlayer();
    expect(realm.created).toBe(true);
    expect((await ensureRealm(userId, "2026-11-20")).created).toBe(false);
    const t = await territories(profileId);
    expect(t).toHaveLength(12);
    expect(t.filter((x) => x.owner_type === "HERO").map((x) => x.territory_code)).toEqual(["capital"]);
    expect(t.filter((x) => x.owner_type === "RIVAL")).toHaveLength(2);
    expect(await army(profileId)).toEqual({ infantry: 5 });
    expect((await kingdom(profileId)).last_day).toBe("2026-11-14");
    const { rows } = await svc.query("select building_type, level, construction_status from buildings where kingdom_id = $1", [(await kingdom(profileId)).id]);
    expect(rows).toEqual([{ building_type: "castle", level: 1, construction_status: "COMPLETED" }]);
  });

  it.each([1, 7, 30, 365])("world catch-up over %i days matches the engine and the ledger", async (n) => {
    const start = "2025-06-01";
    const { userId, profileId } = await newPlayer(start);
    const initial = await engineState(profileId);
    const today = shift(start, n);
    const batches = await catchUp(userId, profileId, today);
    expect(batches).toBe(Math.ceil(n / 31));

    const expected = simulateWorldBatch(initial.eco, initial.world, { rngSeed: 4242, level: 1 }, shift(start, -1), today, dayEnd, 10_000);
    const k = await kingdom(profileId);
    expect(k.last_day).toBe(shift(today, -1));
    expect({ gold: k.gold, food: k.food, knowledge: k.knowledge, influence: k.influence, command_points: k.command_points }).toEqual(expected.economy.resources);
    const t = await territories(profileId);
    for (const w of expected.world) expect(t.find((x) => x.territory_code === w.code)!.owner_type).toBe(w.owner);

    const { rows: ledger } = await svc.query(
      "select resource, sum(delta)::int as s from resource_ledger where kingdom_id = $1 group by resource",
      [k.id],
    );
    const sum = Object.fromEntries(ledger.map((r) => [r.resource, r.s]));
    expect(sum.gold).toBe(k.gold);
    expect(sum.food).toBe(k.food);
    expect(await catchUp(userId, profileId, today)).toBe(0);
  });

  it("world tick rejects stale batches and can never change the player's lands", async () => {
    const { userId, profileId } = await newPlayer();
    const k = await kingdom(profileId);
    const payload = { last_day: "2026-11-15", totals: { gold: 10 }, morale: 80, territories: [{ code: "capital", owner: "RIVAL", garrison: 1, fortification: 0 }], campaigns: [] };
    expect((await applyWorld(userId, k.last_day, payload)).status).toBe("applied");
    expect((await applyWorld(userId, k.last_day, payload)).status).toBe("stale");
    const capital = (await territories(profileId)).find((x) => x.territory_code === "capital")!;
    expect(capital.owner_type).toBe("HERO");
    expect((await kingdom(profileId)).gold).toBe(510);
  });

  it("building is atomic, idempotent and one at a time", async () => {
    const { userId, profileId } = await newPlayer();
    const r = await build(userId, "build-key-0001", "capital", "farm", 1);
    expect(r.status).toBe("started");
    expect((await kingdom(profileId)).gold).toBe(500 - 80);
    expect((await build(userId, "build-key-0001", "capital", "farm", 1)).status).toBe("duplicate");
    expect((await kingdom(profileId)).gold).toBe(420);
    await expect(build(userId, "build-key-0002", "capital", "market", 1)).rejects.toThrow(/CONSTRUCTION_BUSY/);

    await finishConstruction(profileId);
    await expect(build(userId, "build-key-0003", "capital", "farm", 1)).rejects.toThrow(/BUILD_LEVEL_MISMATCH/);
    await expect(build(userId, "build-key-0004", "capital", "farm", 3, 2)).rejects.toThrow(/BUILD_LEVEL_MISMATCH|BUILD_MAX_LEVEL/);
    await expect(build(userId, "build-key-0005", "river_fords", "farm", 1)).rejects.toThrow(/TERRITORY_NOT_OWNED/);
    await expect(build(userId, "build-key-0006", "capital", "castle", 5, 5)).rejects.toThrow(/BUILD_LEVEL_MISMATCH/);

    await svc.query("update kingdoms set gold = 50 where id = $1", [(await kingdom(profileId)).id]);
    await expect(build(userId, "build-key-0007", "capital", "market", 1)).rejects.toThrow(/INSUFFICIENT_RESOURCES/);
    const { rows } = await svc.query("select count(*)::int as n from buildings where building_type = 'market' and kingdom_id = $1", [(await kingdom(profileId)).id]);
    expect(rows[0].n).toBe(0);
    expect((await kingdom(profileId)).gold).toBe(50);
  });

  it("recruiting needs completed barracks, respects the army cap and is idempotent", async () => {
    const { userId, profileId } = await newPlayer();
    await expect(recruit(userId, "rec-key-0001", "infantry", 5, 20)).rejects.toThrow(/REQUIREMENTS_NOT_MET/);
    await build(userId, "build-barr-01", "capital", "barracks", 1);
    await expect(recruit(userId, "rec-key-0002", "infantry", 5, 20)).rejects.toThrow(/REQUIREMENTS_NOT_MET/); // still building
    await finishConstruction(profileId);

    const goldBefore = (await kingdom(profileId)).gold;
    expect((await recruit(userId, "rec-key-0003", "infantry", 5, 20)).status).toBe("recruited");
    expect((await recruit(userId, "rec-key-0003", "infantry", 5, 20)).status).toBe("duplicate");
    expect(await army(profileId)).toEqual({ infantry: 10 });
    expect((await kingdom(profileId)).gold).toBe(goldBefore - 100);
    await expect(recruit(userId, "rec-key-0004", "archers", 25, 30, 30)).rejects.toThrow(/ARMY_FULL/);
  });

  it("battles: adjacency, capture with rewards, one command point, no double resolve", async () => {
    const { userId, profileId } = await newPlayer();
    await expect(attack(userId, profileId, "atk-key-0001", "stone_hills")).rejects.toThrow(/TERRITORY_NOT_ADJACENT/);
    await expect(attack(userId, profileId, "atk-key-0002", "capital")).rejects.toThrow(/TERRITORY_NOT_ADJACENT/);

    const before = await kingdom(profileId);
    const { r, res } = await attack(userId, profileId, "atk-key-0003", "river_fords");
    expect(r.status).toBe("resolved");
    expect(res.win).toBe(true);
    const after = await kingdom(profileId);
    expect(after.command_points).toBe(before.command_points - 1);
    expect(after.gold).toBe(before.gold + res.rewards.gold);
    expect(after.food).toBe(before.food + res.rewards.food);
    const fords = (await territories(profileId)).find((x) => x.territory_code === "river_fords")!;
    expect(fords.owner_type).toBe("HERO");
    expect(fords.garrison_strength).toBe(10);
    expect((await army(profileId)).infantry ?? 0).toBe(5 - (res.casualties.infantry ?? 0));

    // Replaying the same request does nothing.
    const again = await svc.query("select public.resolve_battle($1,$2,'river_fords','{}'::jsonb,0,'{}'::jsonb) as r", [userId, "atk-key-0003"]);
    expect(again.rows[0].r.status).toBe("duplicate");
    expect((await kingdom(profileId)).command_points).toBe(after.command_points);

    // Newly adjacent land opens up after the capture.
    const { rows } = await svc.query("select count(*)::int as n from battles where game_profile_id = $1", [profileId]);
    expect(rows[0].n).toBe(1);
  });

  it("battles: stale army is refused; command points cannot be overspent concurrently", async () => {
    const { userId, profileId } = await newPlayer();
    const stale = await svc.query("select public.resolve_battle($1,'atk-stale-01','river_fords',$2,18,$3) as r", [
      userId, JSON.stringify({ infantry: 99 }), JSON.stringify({ win: true, casualties: {}, garrison_after: 10, fortification_after: 0, rewards: { gold: 999 }, morale_after: 80, seed: 1 }),
    ]);
    expect(stale.rows[0].r.status).toBe("stale");
    expect((await territories(profileId)).find((x) => x.territory_code === "river_fords")!.owner_type).toBe("NEUTRAL");

    await svc.query("update kingdoms set command_points = 1 where game_profile_id = $1 and owner_type = 'HERO'", [profileId]);
    const clients = await Promise.all([serviceClient(url), serviceClient(url), serviceClient(url)]);
    const results = await Promise.allSettled(clients.map((c, i) => attack(userId, profileId, `atk-race-0${i}`, i === 0 ? "river_fords" : "whisper_woods", c)));
    await Promise.all(clients.map((c) => c.end()));
    const resolved = results.filter((x) => x.status === "fulfilled" && x.value.r.status === "resolved");
    expect(resolved).toHaveLength(1);
    expect((await kingdom(profileId)).command_points).toBe(0);
    await expect(attack(userId, profileId, "atk-none-01", "whisper_woods")).rejects.toThrow(/NO_COMMAND_POINTS/);
  });

  it("RLS: players read only their own realm and cannot write it or call its functions", async () => {
    const a = await newPlayer();
    const b = await newPlayer();
    const ua = await userClient(url, a.userId);
    try {
      expect((await ua.query("select count(*)::int as n from territories")).rows[0].n).toBe(12);
      expect((await ua.query("select count(*)::int as n from buildings")).rows[0].n).toBe(1);
      expect((await ua.query("select count(*)::int as n from army_units")).rows[0].n).toBe(1);
      expect((await ua.query("select count(*)::int as n from territories where game_profile_id = $1", [b.profileId])).rows[0].n).toBe(0);
      await expect(ua.query("update territories set owner_type = 'HERO'")).rejects.toThrow(/permission denied/);
      await expect(ua.query("update army_units set quantity = 999")).rejects.toThrow(/permission denied/);
      await expect(ua.query("insert into battles (game_profile_id, attacker_side, defender_side, territory_code, battle_seed, result) values ($1, 'HERO', 'NEUTRAL', 'x', 1, 'ATTACKER_WON')", [a.profileId])).rejects.toThrow(/permission denied/);
      for (const sql of [
        "select public.start_building($1, 'kkkkkkkk', 'capital', 'farm', 1, 2, false, '{}'::jsonb, 1)",
        "select public.recruit_units($1, 'kkkkkkkk', 'infantry', 1, 1, '{}'::jsonb, '{}'::jsonb, 99)",
        "select public.resolve_battle($1, 'kkkkkkkk', 'river_fords', '{}'::jsonb, 0, '{}'::jsonb)",
        "select public.apply_world_days($1, current_date, '{}'::jsonb)",
      ]) {
        await expect(ua.query(sql, [a.userId])).rejects.toThrow(/permission denied/);
      }
    } finally {
      await ua.end();
    }
  });
});
