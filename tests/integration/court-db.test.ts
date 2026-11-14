import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STARTING_HERO_STATS, STARTING_RESOURCES } from "@/data/kingdom";
import { NPCS, STARTING_RELATIONS } from "@/data/court/npcs";
import { MAP_CODE, neighboursOf, TERRITORIES } from "@/data/realm/map";
import { STARTING_ARMY } from "@/data/realm/units";
import { KAEL, KAEL_STARTING_STATS, SIMULATION_VERSION } from "@/data/rival/kael";
import { SKILL_CODES } from "@/data/skills";
import { createTestDatabase, serviceClient, TEST_DATABASE_URL, userClient } from "./db";

const run = TEST_DATABASE_URL ? describe : describe.skip;
const DAY = "2026-11-20";

run("database: royal court", () => {
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

  const seedNpcs = () =>
    JSON.stringify(
      NPCS.map((n) => ({ code: n.code, name: n.name, age: n.age, role: n.role, personality: { traits: n.traits }, positions: n.positions, stats: n.start, recruited: !n.joins })),
    );

  async function newPlayer() {
    const userId = randomUUID();
    const c = await serviceClient(url);
    await c.query("reset role");
    await c.query("insert into auth.users (id, email) values ($1, $2)", [userId, `${userId}@test.local`]);
    await c.end();
    const { rows } = await svc.query("select public.start_game($1,$2,$3,$4,$5,$6,$7,$8,$9) as r", [
      userId, "Игорь", "UTC", 55, "Арен", "Северная марка", [...SKILL_CODES], JSON.stringify(STARTING_RESOURCES), JSON.stringify(STARTING_HERO_STATS),
    ]);
    await svc.query("select public.ensure_rival($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [
      userId, KAEL.name, KAEL.kingdomName, JSON.stringify({ discipline: KAEL.disciplineFactor, learning: 1, risk: KAEL.riskTolerance, dailyMinutes: 45 }),
      4242, SIMULATION_VERSION, DAY, [...SKILL_CODES], JSON.stringify(KAEL_STARTING_STATS), JSON.stringify(STARTING_RESOURCES),
    ]);
    await svc.query("select public.ensure_realm($1, $2, $3, $4, $5, 80)", [
      userId, MAP_CODE, JSON.stringify(TERRITORIES.map((t) => ({ ...t, faction: t.faction ?? null, neighbors: neighboursOf(t.code) }))), DAY, JSON.stringify(STARTING_ARMY),
    ]);
    const r = await svc.query("select public.ensure_court($1, $2, $3) as r", [userId, seedNpcs(), JSON.stringify(STARTING_RELATIONS)]);
    return { userId, profileId: rows[0].r.profile_id as string, created: r.rows[0].r.created as boolean };
  }

  const npc = async (profileId: string, code: string) =>
    (await svc.query("select * from court_npcs where game_profile_id = $1 and npc_code = $2", [profileId, code])).rows[0];
  const gold = async (profileId: string) =>
    Number((await svc.query("select gold from kingdoms where game_profile_id = $1 and owner_type = 'HERO'", [profileId])).rows[0].gold);

  function change(row: Record<string, unknown>, stats: Record<string, number>, extra: Record<string, unknown> = {}) {
    return {
      code: row.npc_code,
      expected_version: row.version,
      stats: { loyalty: row.loyalty, affection: row.affection, trust: row.trust, ambition: row.ambition, jealousy: row.jealousy, influence: row.influence, ...stats },
      status: extra.status ?? row.relationship_status,
      position: "position" in extra ? extra.position : row.position,
    };
  }

  const interact = (userId: string, key: string, code: string, changes: unknown, day = DAY, action = "talk") =>
    svc
      .query("select public.court_interact($1,$2,$3,$4,$5,$6,$7) as r", [userId, key, code, action, day, JSON.stringify(changes), JSON.stringify({ content: "Привет", source: "FALLBACK" })])
      .then((r) => r.rows[0].r as { status: string });

  const openEvent = (userId: string, code: string, day = DAY, choices = [{ code: "a", label: "A" }, { code: "b", label: "B" }], max = 2) =>
    svc.query("select public.open_court_event($1,$2,$3,$4,$5,$6) as r", [userId, day, code, ["liara"], JSON.stringify(choices), max]).then((r) => r.rows[0].r as { status: string; id: string });

  const choose = (userId: string, key: string, eventId: string, choice: string, changes: unknown) =>
    svc
      .query("select public.court_choose($1,$2,$3,$4,$5,$6,$7) as r", [userId, key, eventId, choice, DAY, JSON.stringify(changes), JSON.stringify({ title: "T", choice: "C", text: "X" })])
      .then((r) => r.rows[0].r as { status: string });

  const assign = (userId: string, key: string, position: string, code: string | null, changes: unknown) =>
    svc.query("select public.court_assign($1,$2,$3,$4,$5) as r", [userId, key, position, code, JSON.stringify(changes)]).then((r) => r.rows[0].r as { status: string });

  it("ensure_court seeds the characters and their ties once; newcomers join once", async () => {
    const { userId, profileId, created } = await newPlayer();
    expect(created).toBe(true);
    const again = await svc.query("select public.ensure_court($1, $2, $3) as r", [userId, seedNpcs(), JSON.stringify(STARTING_RELATIONS)]);
    expect(again.rows[0].r.created).toBe(false);
    const { rows } = await svc.query("select npc_code, recruited_at is not null as recruited from court_npcs where game_profile_id = $1 order by npc_code", [profileId]);
    expect(rows).toHaveLength(8);
    expect(rows.filter((r) => r.recruited).map((r) => r.npc_code)).toEqual(["bram", "liara", "meyrin", "selvina", "torvald"]);
    expect((await svc.query("select count(*)::int as n from court_relationships where game_profile_id = $1", [profileId])).rows[0].n).toBe(STARTING_RELATIONS.length);

    const r1 = await svc.query("select public.court_recruit($1, $2) as r", [userId, ["rein", "liara"]]);
    expect(r1.rows[0].r.joined).toEqual(["rein"]);
    const r2 = await svc.query("select public.court_recruit($1, $2) as r", [userId, ["rein"]]);
    expect(r2.rows[0].r.joined).toEqual([]);
  });

  it("interactions: once per day, idempotent, versioned, logged", async () => {
    const { userId, profileId } = await newPlayer();
    const before = await npc(profileId, "liara");
    const r = await interact(userId, "int-key-0001", "liara", { npcs: [change(before, { affection: 30 }, { status: "ACQUAINTED" })] });
    expect(r.status).toBe("applied");
    const after = await npc(profileId, "liara");
    expect(after.affection).toBe(30);
    expect(after.relationship_status).toBe("ACQUAINTED");
    expect(after.version).toBe(before.version + 1);
    expect(after.last_interaction_day.toISOString().slice(0, 10)).toBe(DAY);
    expect((await interact(userId, "int-key-0001", "liara", { npcs: [] })).status).toBe("duplicate");
    await expect(interact(userId, "int-key-0002", "liara", { npcs: [] })).rejects.toThrow(/ALREADY_INTERACTED/);
    await expect(interact(userId, "int-key-0003", "rein", { npcs: [] })).rejects.toThrow(/NPC_NOT_AVAILABLE/);
    expect((await svc.query("select count(*)::int as n from court_messages where npc_id = $1", [after.id])).rows[0].n).toBe(1);

    // A change computed from an old version is refused and changes nothing.
    const stale = await interact(userId, "int-key-0004", "liara", { npcs: [change(before, { affection: 99 })] }, "2026-11-21");
    expect(stale.status).toBe("stale");
    expect((await npc(profileId, "liara")).affection).toBe(30);
  });

  it("gifts and choices pay through the ledger and never overdraw", async () => {
    const { userId, profileId } = await newPlayer();
    const g0 = await gold(profileId);
    const row = await npc(profileId, "bram");
    expect((await interact(userId, "gift-key-01", "bram", { npcs: [change(row, { affection: 44 })], resources: { gold: -30 } }, DAY, "gift")).status).toBe("applied");
    expect(await gold(profileId)).toBe(g0 - 30);
    const ledger = await svc.query("select delta::int from resource_ledger where game_profile_id = $1 and reason = 'COURT'", [profileId]);
    expect(ledger.rows.map((x) => x.delta)).toEqual([-30]);

    const torvald = await npc(profileId, "torvald");
    await expect(interact(userId, "gift-key-02", "torvald", { npcs: [change(torvald, { loyalty: 99 })], resources: { gold: -999999 } }, DAY, "gift")).rejects.toThrow(/INSUFFICIENT_RESOURCES/);
    expect((await npc(profileId, "torvald")).loyalty).toBe(torvald.loyalty);
    expect((await npc(profileId, "torvald")).last_interaction_day).toBeNull();
  });

  it("events: one per day, at most two waiting, each only once", async () => {
    const { userId } = await newPlayer();
    expect((await openEvent(userId, "liara_1")).status).toBe("opened");
    expect((await openEvent(userId, "torvald_1")).status).toBe("exists");
    expect((await openEvent(userId, "torvald_1", "2026-11-21")).status).toBe("opened");
    expect((await openEvent(userId, "bram_1", "2026-11-22")).status).toBe("full");
    expect((await openEvent(userId, "liara_1", "2026-11-23", undefined, 5)).status).toBe("exists");
  });

  it("choosing: only offered choices, once, atomically, territory only from neutral or faction", async () => {
    const { userId, profileId } = await newPlayer();
    const ev = await openEvent(userId, "liara_3", DAY, [{ code: "alliance", label: "Союз" }, { code: "trade", label: "Торговля" }]);
    const liara = await npc(profileId, "liara");
    await expect(choose(userId, "choose-k-01", ev.id, "nope", { npcs: [] })).rejects.toThrow(/VALIDATION_ERROR/);

    // Port taken by Kael meanwhile: the whole choice rolls back.
    await svc.query("update territories set owner_type = 'RIVAL' where game_profile_id = $1 and territory_code = 'merchant_port'", [profileId]);
    await expect(choose(userId, "choose-k-02", ev.id, "alliance", { npcs: [change(liara, { loyalty: 90 })], territory: "merchant_port", resources: { influence: 8 } })).rejects.toThrow(/TERRITORY_UNAVAILABLE/);
    expect((await npc(profileId, "liara")).loyalty).toBe(liara.loyalty);
    await svc.query("update territories set owner_type = 'FACTION' where game_profile_id = $1 and territory_code = 'merchant_port'", [profileId]);

    const r = await choose(userId, "choose-k-03", ev.id, "alliance", { npcs: [change(liara, { loyalty: 52 })], territory: "merchant_port", resources: { influence: 8 }, morale: 5 });
    expect(r.status).toBe("applied");
    const port = (await svc.query("select owner_type from territories where game_profile_id = $1 and territory_code = 'merchant_port'", [profileId])).rows[0];
    expect(port.owner_type).toBe("HERO");
    expect((await svc.query("select status, selected_choice from court_events where id = $1", [ev.id])).rows[0]).toEqual({ status: "RESOLVED", selected_choice: "alliance" });
    expect((await choose(userId, "choose-k-03", ev.id, "alliance", { npcs: [] })).status).toBe("duplicate");
    await expect(choose(userId, "choose-k-04", ev.id, "trade", { npcs: [] })).rejects.toThrow(/EVENT_NOT_OPEN/);
    const morale = (await svc.query("select a.morale from armies a join kingdoms k on k.id = a.kingdom_id where k.game_profile_id = $1", [profileId])).rows[0].morale;
    expect(morale).toBe(85);
  });

  it("positions: one holder, eligibility checked, the army follows the commander", async () => {
    const { userId, profileId } = await newPlayer();
    const torvald = await npc(profileId, "torvald");
    expect((await assign(userId, "assign-k-01", "commander", "torvald", { npcs: [change(torvald, { loyalty: 65 }, { position: "commander" })] })).status).toBe("applied");
    const army = (await svc.query("select a.commander_npc_id from armies a join kingdoms k on k.id = a.kingdom_id where k.game_profile_id = $1", [profileId])).rows[0];
    expect(army.commander_npc_id).toBe(torvald.id);

    const bram = await npc(profileId, "bram");
    await expect(assign(userId, "assign-k-02", "commander", "bram", { npcs: [change(bram, {}, { position: "commander" })] })).rejects.toThrow(/VALIDATION_ERROR/);
    // A change set that does not appoint the requested character is refused.
    const liara = await npc(profileId, "liara");
    await expect(assign(userId, "assign-k-03", "envoy", "liara", { npcs: [change(liara, { loyalty: 41 })] })).rejects.toThrow(/VALIDATION_ERROR/);

    await svc.query("select public.court_recruit($1, $2)", [userId, ["rein"]]);
    const rein = await npc(profileId, "rein");
    const t2 = await npc(profileId, "torvald");
    expect((await assign(userId, "assign-k-04", "commander", "rein", { npcs: [change(t2, { loyalty: 57 }, { position: null }), change(rein, { loyalty: 50 }, { position: "commander" })] })).status).toBe("applied");
    const holders = await svc.query("select npc_code from court_npcs where game_profile_id = $1 and position = 'commander'", [profileId]);
    expect(holders.rows.map((x) => x.npc_code)).toEqual(["rein"]);

    const t3 = await npc(profileId, "torvald");
    await expect(svc.query("select public.court_assign($1,'assign-k-05','commander','torvald',$2)", [userId, JSON.stringify({ npcs: [change(t3, {}, { position: "commander" })] })])).rejects.toThrow(/duplicate key|court_npcs_position_uq/);
  });

  it("RLS: players read only their own court and cannot change it", async () => {
    const a = await newPlayer();
    const b = await newPlayer();
    const ua = await userClient(url, a.userId);
    try {
      expect((await ua.query("select count(*)::int as n from court_npcs")).rows[0].n).toBe(8);
      expect((await ua.query("select count(*)::int as n from court_npcs where game_profile_id = $1", [b.profileId])).rows[0].n).toBe(0);
      await expect(ua.query("update court_npcs set affection = 100")).rejects.toThrow(/permission denied/);
      await expect(ua.query("insert into court_events (game_profile_id, event_code, event_day) values ($1, 'x_1', current_date)", [a.profileId])).rejects.toThrow(/permission denied/);
      for (const sql of [
        "select public.court_interact($1, 'kkkkkkkk', 'liara', 'talk', current_date, '{}'::jsonb, '{}'::jsonb)",
        "select public.court_choose($1, 'kkkkkkkk', gen_random_uuid(), 'a', current_date, '{}'::jsonb, '{}'::jsonb)",
        "select public.court_assign($1, 'kkkkkkkk', 'envoy', null, '{}'::jsonb)",
        "select public.open_court_event($1, current_date, 'x_1', '{}', '[]'::jsonb, 2)",
        "select public.court_recruit($1, '{}')",
      ]) {
        await expect(ua.query(sql, [a.userId])).rejects.toThrow(/permission denied/);
      }
    } finally {
      await ua.end();
    }
  });
});
