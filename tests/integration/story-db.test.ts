import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STARTING_HERO_STATS, STARTING_RESOURCES } from "@/data/kingdom";
import { NPCS, STARTING_RELATIONS } from "@/data/court/npcs";
import { buildingCost } from "@/data/realm/buildings";
import { MAP_CODE, neighboursOf, TERRITORIES } from "@/data/realm/map";
import { STARTING_ARMY } from "@/data/realm/units";
import { KAEL, KAEL_STARTING_STATS, SIMULATION_BATCH_DAYS, SIMULATION_VERSION } from "@/data/rival/kael";
import { SKILL_CODES } from "@/data/skills";
import { CHAPTER_BY_CODE } from "@/data/story/chapters";
import { ACHIEVEMENTS } from "@/data/story/rewards";
import { planDailyQuests } from "@/engine/quests/planner";
import { resolveBattle, type Army } from "@/engine/realm/battle";
import { simulateBatch } from "@/engine/simulation/rival";
import { buildApplyPayload, rivalStateFromRows, type RivalProfileRow } from "@/engine/simulation/rival-persistence";
import { choiceChanges, unitPowerWeights } from "@/engine/story/story";
import { createTestDatabase, serviceClient, TEST_DATABASE_URL, userClient } from "./db";

const run = TEST_DATABASE_URL ? describe : describe.skip;
const DAY = "2026-11-20";
const W = JSON.stringify(unitPowerWeights());
const ch2 = CHAPTER_BY_CODE.ch2;

run("database: story, achievements, titles, items", () => {
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

  async function newUser() {
    const userId = randomUUID();
    const c = await serviceClient(url);
    await c.query("reset role");
    await c.query("insert into auth.users (id, email) values ($1, $2)", [userId, `${userId}@test.local`]);
    await c.end();
    return userId;
  }

  async function startGame(userId: string) {
    const { rows } = await svc.query("select public.start_game($1,$2,$3,$4,$5,$6,$7,$8,$9) as r", [
      userId, "Игорь", "UTC", 55, "Арен", "Северная марка", [...SKILL_CODES], JSON.stringify(STARTING_RESOURCES), JSON.stringify(STARTING_HERO_STATS),
    ]);
    return rows[0].r.profile_id as string;
  }

  const ensureRival = (userId: string, day: string) =>
    svc.query("select public.ensure_rival($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as r", [
      userId, KAEL.name, KAEL.kingdomName,
      JSON.stringify({ discipline: KAEL.disciplineFactor, learning: KAEL.learningFactor, risk: KAEL.riskTolerance, dailyMinutes: KAEL.dailyMinutes }),
      4242, SIMULATION_VERSION, day, [...SKILL_CODES], JSON.stringify(KAEL_STARTING_STATS), JSON.stringify(STARTING_RESOURCES),
    ]);

  const ensureRealm = (userId: string, day: string) =>
    svc.query("select public.ensure_realm($1, $2, $3, $4, $5, 80)", [
      userId, MAP_CODE, JSON.stringify(TERRITORIES.map((t) => ({ ...t, faction: t.faction ?? null, neighbors: neighboursOf(t.code) }))), day, JSON.stringify(STARTING_ARMY),
    ]);

  const ensureCourt = (userId: string) =>
    svc.query("select public.ensure_court($1, $2, $3)", [
      userId,
      JSON.stringify(NPCS.map((n) => ({ code: n.code, name: n.name, age: n.age, role: n.role, personality: {}, positions: n.positions, stats: n.start, recruited: !n.joins }))),
      JSON.stringify(STARTING_RELATIONS),
    ]);

  async function newPlayer() {
    const userId = await newUser();
    const profileId = await startGame(userId);
    await ensureRival(userId, DAY);
    await ensureRealm(userId, DAY);
    await ensureCourt(userId);
    await svc.query("select public.ensure_story($1, 'ch1')", [userId]);
    return { userId, profileId };
  }

  const one = async <T = Record<string, unknown>>(sql: string, args: unknown[]) => (await svc.query(sql, args)).rows[0] as T;
  const progress = (profileId: string, chapter: string) => one<Record<string, unknown>>("select * from story_progress where game_profile_id = $1 and chapter_code = $2", [profileId, chapter]);
  const kingdom = (profileId: string) => one<Record<string, unknown>>("select * from kingdoms where game_profile_id = $1 and owner_type = 'HERO'", [profileId]);
  const metrics = async (profileId: string) => {
    const k = await kingdom(profileId);
    return (await one<{ m: Record<string, number> }>("select public.nemesis_story_metrics($1, $2, $3) as m", [profileId, k.id, W])).m;
  };
  async function army(profileId: string): Promise<Army> {
    const { rows } = await svc.query(
      "select u.unit_type, u.quantity from army_units u join armies a on a.id = u.army_id join kingdoms k on k.id = a.kingdom_id where k.game_profile_id = $1 and k.owner_type = 'HERO' and u.quantity > 0",
      [profileId],
    );
    return Object.fromEntries(rows.map((r) => [r.unit_type, r.quantity]));
  }

  const seen = (userId: string, chapter: string, scene = "intro") => svc.query("select public.story_mark_seen($1,$2,$3)", [userId, chapter, scene]);
  const decide = (userId: string, key: string, chapter: string, choice: string) => {
    const ch = CHAPTER_BY_CODE[chapter];
    const c = ch.decision.choices.find((x) => x.code === choice)!;
    return svc
      .query("select public.story_choose($1,$2,$3,$4,$5,$6,$7,$8) as r", [
        userId, key, chapter, choice, ch.decision.choices.map((x) => x.code), DAY, JSON.stringify(choiceChanges(c)), JSON.stringify({ title: ch.decision.title, choice: c.label }),
      ])
      .then((r) => r.rows[0].r as { status: string });
  };

  async function boss(userId: string, profileId: string, key: string, chapter: string, day = DAY) {
    const ch = CHAPTER_BY_CODE[chapter];
    const a = await army(profileId);
    const res = resolveBattle({ army: a, morale: 80, commander: "self", strategy: 10, tactic: "balanced", target: ch.boss!.target, seed: 11 });
    const r = await svc.query("select public.story_boss($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as r", [
      userId, key, chapter, ch.boss!.code, day, JSON.stringify(ch.objectives.map((o) => ({ metric: o.metric, target: o.target }))), W, JSON.stringify(a),
      JSON.stringify({ win: res.win, casualties: res.casualties, morale_after: res.moraleAfter, seed: 11, tactic: "balanced", defender_side: ch.boss!.defender, attacker_snapshot: { power: res.attackerPower }, defender_snapshot: { name: ch.boss!.name, power: res.defenderPower } }),
      JSON.stringify(ch.boss!.rewards), ch.boss!.item ?? null,
    ]);
    return { r: r.rows[0].r as { status: string; win?: boolean }, res };
  }

  const complete = (userId: string, key: string, chapter: string, next: string | null, nextNumber = 2) => {
    const ch = CHAPTER_BY_CODE[chapter];
    return svc
      .query("select public.story_complete_chapter($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as r", [
        userId, key, chapter, JSON.stringify(ch.objectives.map((o) => ({ metric: o.metric, target: o.target }))), W, Boolean(ch.boss),
        JSON.stringify(ch.rewards.resources), ch.rewards.items, ch.rewards.titles, next, nextNumber,
      ])
      .then((r) => r.rows[0].r as { status: string; next: string | null });
  };

  /** Meet chapter 1 objectives directly in the tables (the journey test does it the real way). */
  async function meetCh1(profileId: string) {
    const k = await kingdom(profileId);
    await svc.query(
      "insert into quests (game_profile_id, title, category, frequency, difficulty, estimated_minutes, base_xp, status, scheduled_date, deadline_at, completed_at, source) " +
        "select $1, 'q' || g, 'study', 'DAILY', 1, 15, 20, 'COMPLETED', $2::date - g, now(), now(), 'MANUAL' from generate_series(1, 3) g",
      [profileId, DAY],
    );
    await svc.query(
      "insert into buildings (kingdom_id, territory_id, building_type, level, construction_status, completed_at) select $1, id, 'farm', 1, 'COMPLETED', now() from territories where game_profile_id = $2 and territory_code = 'capital'",
      [k.id, profileId],
    );
    await svc.query(
      "insert into battles (game_profile_id, attacker_side, defender_side, territory_code, battle_seed, result) values ($1, 'HERO', 'NEUTRAL', 'river_fords', 1, 'ATTACKER_WON')",
      [profileId],
    );
    await svc.query("update army_units set quantity = 20 where army_id = (select id from armies where kingdom_id = $1)", [k.id]);
  }

  it("the first chapter starts once; metrics come from real state", async () => {
    const { userId, profileId } = await newPlayer();
    expect((await one<{ r: { created: boolean } }>("select public.ensure_story($1, 'ch1') as r", [userId])).r.created).toBe(false);
    const p = await progress(profileId, "ch1");
    expect(p).toMatchObject({ status: "ACTIVE", intro_seen: false, decision: null, boss_defeated: false });
    const m = await metrics(profileId);
    expect(m).toMatchObject({ questsCompleted: 0, heroLevel: 1, buildings: 0, battlesWon: 0, territories: 1, armyPower: 60, chaptersCompleted: 0 });
    await meetCh1(profileId);
    expect(await metrics(profileId)).toMatchObject({ questsCompleted: 3, buildings: 1, battlesWon: 1, armyPower: 240 });
  });

  it("the decision needs the intro, applies once and cannot overspend", async () => {
    const { userId, profileId } = await newPlayer();
    await expect(decide(userId, "dec-key-0001", "ch1", "workers")).rejects.toThrow(/STORY_LOCKED/);
    await seen(userId, "ch1");
    const before = await kingdom(profileId);
    expect((await decide(userId, "dec-key-0002", "ch1", "workers")).status).toBe("applied");
    const after = await kingdom(profileId);
    expect(Number(after.gold)).toBe(Number(before.gold) - 60);
    expect(Number(after.influence)).toBe(Number(before.influence) + 3);
    expect((await decide(userId, "dec-key-0002", "ch1", "workers")).status).toBe("duplicate");
    await expect(decide(userId, "dec-key-0003", "ch1", "grain")).rejects.toThrow(/STORY_LOCKED/);
    expect((await progress(profileId, "ch1")).decision).toBe("workers");

    const poor = await newPlayer();
    await seen(poor.userId, "ch1");
    await svc.query("update kingdoms set food = 10 where game_profile_id = $1 and owner_type = 'HERO'", [poor.profileId]);
    await expect(decide(poor.userId, "dec-key-0004", "ch1", "grain")).rejects.toThrow(/INSUFFICIENT_RESOURCES/);
    expect((await progress(poor.profileId, "ch1")).decision).toBeNull();
  });

  it("the boss waits for the objectives, costs a command point and allows one attempt a day", async () => {
    const { userId, profileId } = await newPlayer();
    await seen(userId, "ch1");
    await decide(userId, "dec-key-0101", "ch1", "later");
    await expect(boss(userId, profileId, "boss-key-0001", "ch1")).rejects.toThrow(/OBJECTIVES_INCOMPLETE/);
    await meetCh1(profileId);
    const cp = Number((await kingdom(profileId)).command_points);
    const { r, res } = await boss(userId, profileId, "boss-key-0002", "ch1");
    expect(r.status).toBe("resolved");
    expect(res.win).toBe(true);
    expect(Number((await kingdom(profileId)).command_points)).toBe(cp - 1);
    expect(await army(profileId)).toEqual(res.survivors);
    const p = await progress(profileId, "ch1");
    expect(p).toMatchObject({ boss_defeated: true, boss_attempts: 1 });
    const inv = await svc.query("select item_code from inventory_items where game_profile_id = $1", [profileId]);
    expect(inv.rows.map((x) => x.item_code)).toEqual(["bandit_banner"]);
    const b = await one("select defender_side, territory_code, result from battles where game_profile_id = $1 and territory_code like 'boss:%'", [profileId]);
    expect(b).toEqual({ defender_side: "NEUTRAL", territory_code: "boss:bandit_chief", result: "ATTACKER_WON" });
    expect((await boss(userId, profileId, "boss-key-0002", "ch1")).r.status).toBe("duplicate");
    await expect(boss(userId, profileId, "boss-key-0003", "ch1", "2026-11-21")).rejects.toThrow(/STORY_LOCKED/);
  });

  it("a lost assault waits until tomorrow; a changed army is stale", async () => {
    const { userId, profileId } = await newPlayer();
    await seen(userId, "ch1");
    await decide(userId, "dec-key-0201", "ch1", "later");
    await meetCh1(profileId);
    await svc.query("update army_units set quantity = 1 where army_id = (select a.id from armies a join kingdoms k on k.id = a.kingdom_id where k.game_profile_id = $1)", [profileId]);
    await svc.query("update battles set result = 'ATTACKER_WON' where game_profile_id = $1", [profileId]);
    // armyPower objective is not part of chapter 1, so a tiny army may try (and lose).
    const { r } = await boss(userId, profileId, "boss-key-0201", "ch1");
    expect(r).toMatchObject({ status: "resolved", win: false });
    await expect(boss(userId, profileId, "boss-key-0202", "ch1")).rejects.toThrow(/BOSS_COOLDOWN/);

    await svc.query("update army_units set quantity = 5 where army_id = (select a.id from armies a join kingdoms k on k.id = a.kingdom_id where k.game_profile_id = $1)", [profileId]);
    const a = await army(profileId);
    const stale = await svc.query("select public.story_boss($1,'boss-key-0203','ch1','bandit_chief','2026-11-21','[]'::jsonb,$2,$3,'{}'::jsonb,'{}'::jsonb,null) as r", [
      userId, W, JSON.stringify({ ...a, archers: 3 }),
    ]);
    expect(stale.rows[0].r.status).toBe("stale");
  });

  it("completing a chapter grants rewards once and starts the next one", async () => {
    const { userId, profileId } = await newPlayer();
    await seen(userId, "ch1");
    await expect(complete(userId, "cmp-key-0001", "ch1", "ch2")).rejects.toThrow(/STORY_LOCKED/);
    await decide(userId, "dec-key-0301", "ch1", "later");
    await meetCh1(profileId);
    await expect(complete(userId, "cmp-key-0002", "ch1", "ch2")).rejects.toThrow(/STORY_LOCKED/); // boss not defeated
    await boss(userId, profileId, "boss-key-0301", "ch1");
    const gold = Number((await kingdom(profileId)).gold);
    expect(await complete(userId, "cmp-key-0003", "ch1", "ch2")).toMatchObject({ status: "completed", next: "ch2" });
    expect((await complete(userId, "cmp-key-0003", "ch1", "ch2")).status).toBe("duplicate");
    expect(Number((await kingdom(profileId)).gold)).toBe(gold + 100);
    expect((await progress(profileId, "ch1")).status).toBe("COMPLETED");
    expect((await progress(profileId, "ch2")).status).toBe("ACTIVE");
    expect((await one("select current_chapter from game_profiles where id = $1", [profileId])).current_chapter).toBe(2);
    const items = await svc.query("select item_code from inventory_items where game_profile_id = $1 order by item_code", [profileId]);
    expect(items.rows.map((x) => x.item_code)).toEqual(["bandit_banner", "father_seal"]);
    const titles = await svc.query("select title_code from unlocked_titles where game_profile_id = $1", [profileId]);
    expect(titles.rows.map((x) => x.title_code)).toEqual(["heir_crowned"]);
    // Chapter 2 has no boss: its objectives still have to be met for real.
    await seen(userId, "ch2");
    await decide(userId, "dec-key-0302", "ch2", "keep");
    await expect(complete(userId, "cmp-key-0004", "ch2", "ch3", 3)).rejects.toThrow(/OBJECTIVES_INCOMPLETE/);
    expect(ch2.boss).toBeUndefined();

    // Story never touches XP.
    expect((await one("select total_xp from game_profiles where id = $1", [profileId])).total_xp).toBe("0");

    // The outro can be marked only after completion; the chronicle is written once.
    await seen(userId, "ch1", "outro");
    await expect(seen(userId, "ch2", "outro")).rejects.toThrow(/STORY_LOCKED/);
    const c1 = await one<{ r: { chronicle: string } }>("select public.story_save_chronicle($1, 'ch1', 'Первая запись', 'AI') as r", [userId]);
    const c2 = await one<{ r: { chronicle: string } }>("select public.story_save_chronicle($1, 'ch1', 'Другая запись', 'FALLBACK') as r", [userId]);
    expect(c1.r.chronicle).toBe("Первая запись");
    expect(c2.r.chronicle).toBe("Первая запись");
    await expect(svc.query("select public.story_save_chronicle($1, 'ch2', 'x', 'AI')", [userId])).rejects.toThrow(/STORY_LOCKED/);
  });

  it("achievements unlock only when earned, once, with their titles", async () => {
    const { userId, profileId } = await newPlayer();
    const list = JSON.stringify(ACHIEVEMENTS.map((a) => ({ code: a.code, name: a.name, metric: a.metric, target: a.target, title: a.title ?? null })));
    const first = await one<{ r: { unlocked: string[] } }>("select public.grant_achievements($1, $2, $3) as r", [userId, list, W]);
    expect(first.r.unlocked).toEqual([]);
    await meetCh1(profileId);
    await svc.query("update battles set result = 'ATTACKER_WON' where game_profile_id = $1", [profileId]);
    await svc.query(
      "insert into battles (game_profile_id, attacker_side, defender_side, territory_code, battle_seed, result) select $1, 'HERO', 'NEUTRAL', 'x', g, 'ATTACKER_WON' from generate_series(1, 4) g",
      [profileId],
    );
    const second = await one<{ r: { unlocked: string[] } }>("select public.grant_achievements($1, $2, $3) as r", [userId, list, W]);
    expect(second.r.unlocked.sort()).toEqual(["conqueror_5", "first_building", "first_quest", "first_victory"]);
    const third = await one<{ r: { unlocked: string[] } }>("select public.grant_achievements($1, $2, $3) as r", [userId, list, W]);
    expect(third.r.unlocked).toEqual([]);
    // A forged entry with a lower target is still checked against real state.
    const forged = await one<{ r: { unlocked: string[] } }>("select public.grant_achievements($1, $2, $3) as r", [
      userId, JSON.stringify([{ code: "lands_6", metric: "territories", target: 6, title: "land_gatherer" }]), W,
    ]);
    expect(forged.r.unlocked).toEqual([]);

    await expect(svc.query("select public.set_active_title($1, 'chronicler')", [userId])).rejects.toThrow(/TITLE_LOCKED/);
    await svc.query("select public.set_active_title($1, 'conqueror')", [userId]);
    expect((await one("select active_title from game_profiles where id = $1", [profileId])).active_title).toBe("conqueror");
    await svc.query("select public.set_active_title($1, null)", [userId]);
    expect((await one("select active_title from game_profiles where id = $1", [profileId])).active_title).toBeNull();
  });

  it("players read only their own story rows and cannot write or call functions", async () => {
    const a = await newPlayer();
    const b = await newPlayer();
    await seen(a.userId, "ch1");
    const ua = await userClient(url, a.userId);
    try {
      const own = await ua.query("select chapter_code from story_progress");
      expect(own.rows).toEqual([{ chapter_code: "ch1" }]);
      const other = await ua.query("select id from story_progress where game_profile_id = $1", [b.profileId]);
      expect(other.rows).toHaveLength(0);
      await expect(ua.query("update story_progress set boss_defeated = true")).rejects.toThrow(/permission denied/);
      await expect(ua.query("insert into inventory_items (game_profile_id, item_code, source) values ($1, 'dawn_blade', 'x')", [a.profileId])).rejects.toThrow(/permission denied/);
      await expect(ua.query("insert into achievements (game_profile_id, achievement_code) values ($1, 'book_one')", [a.profileId])).rejects.toThrow(/permission denied/);
      await expect(ua.query("update game_profiles set active_title = 'chronicler'")).rejects.toThrow(/permission denied/);
      for (const sql of [
        "select public.story_mark_seen($1, 'ch1', 'intro')",
        "select public.set_active_title($1, null)",
        "select public.grant_achievements($1, '[]'::jsonb, '{}'::jsonb)",
        "select public.story_complete_chapter($1, 'kkkkkkkk', 'ch1', '[]'::jsonb, '{}'::jsonb, false, '{}'::jsonb, '{}', '{}', null, 2)",
      ]) {
        await expect(ua.query(sql, [a.userId])).rejects.toThrow(/permission denied/);
      }
    } finally {
      await ua.end();
    }
  });

  // -------------------------------------------------------------------------
  // ТЗ §19.3: the whole first journey through the real SQL functions.
  // -------------------------------------------------------------------------
  it("journey: start → quests → XP → rival → build → recruit → battle → court → story → reconnect", async () => {
    const userId = await newUser();
    const profileId = await startGame(userId);

    // Real quests: planned, completed, XP awarded once.
    const deadline = new Date(Date.now() + 24 * 3600 * 1000);
    const planned = planDailyQuests(profileId, DAY, 55, deadline).map((q) => ({
      template_code: q.templateCode, title: q.title, description: q.description, category: q.category, frequency: q.frequency, difficulty: q.difficulty,
      estimated_minutes: q.estimatedMinutes, base_xp: q.baseXp, is_optional: q.isOptional, success_criteria: q.successCriteria,
      scheduled_date: q.scheduledDate, deadline_at: q.deadlineAt, evaluation_mode: q.evaluationMode,
    }));
    await svc.query("select public.sync_quests($1, $2)", [userId, JSON.stringify(planned)]);
    const { rows: qs } = await svc.query("select id, base_xp from quests where game_profile_id = $1 order by title", [profileId]);
    expect(qs.length).toBeGreaterThanOrEqual(3);
    let xp = 0;
    for (const [i, q] of qs.slice(0, 3).entries()) {
      const r = await svc.query("select public.complete_quest($1, $2, $3, 'A', $4, $5, 0, null, 60, $6) as r", [
        userId, q.id, `journey-quest-${i}`, q.base_xp, Math.floor(q.base_xp / 2), new Date(Date.now() - 3600_000).toISOString(),
      ]);
      expect(r.rows[0].r.status).toBe("completed");
      xp += q.base_xp;
    }
    expect(Number((await one("select total_xp from game_profiles where id = $1", [profileId])).total_xp)).toBe(xp);

    // Rival Kael appears and lives his own days.
    await ensureRival(userId, "2026-11-13");
    const rp = await one<RivalProfileRow & Record<string, unknown>>(
      "select id, name, discipline_factor, learning_factor, risk_tolerance, daily_minutes, level, total_xp, fatigue, to_char(last_simulated_day, 'YYYY-MM-DD') as last_simulated_day, simulation_version, rng_seed from rival_profiles where game_profile_id = $1",
      [profileId],
    );
    const { rows: rSkills } = await svc.query("select skill_code, xp from skills where game_profile_id = $1 and character_type = 'RIVAL'", [profileId]);
    const rGold = (await one("select gold from kingdoms where game_profile_id = $1 and owner_type = 'RIVAL'", [profileId])).gold;
    const batch = simulateBatch(rivalStateFromRows(rp, rSkills, rGold as never), rp.last_simulated_day, DAY, SIMULATION_BATCH_DAYS);
    const applied = await svc.query("select public.apply_rival_days($1,$2,$3) as r", [userId, rp.last_simulated_day, JSON.stringify(buildApplyPayload(batch.days, batch.state))]);
    expect(applied.rows[0].r.status).toBe("applied");
    expect(Number((await one("select total_xp from rival_profiles where game_profile_id = $1", [profileId])).total_xp)).toBeGreaterThan(0);

    // Kingdom: map, a barracks, recruits, a won battle.
    await ensureRealm(userId, DAY);
    const built = await svc.query("select public.start_building($1,'journey-build','capital','barracks',1,2,false,$2,30) as r", [userId, JSON.stringify(buildingCost("barracks", 1))]);
    expect(built.rows[0].r.status).toBe("started");
    await svc.query("update buildings set completed_at = now() - interval '1 minute' where kingdom_id = (select id from kingdoms where game_profile_id = $1 and owner_type = 'HERO')", [profileId]);
    const rec = await svc.query("select public.recruit_units($1,'journey-recruit','infantry',1,5,$2,$3,30) as r", [userId, JSON.stringify({ gold: 100, food: 25 }), JSON.stringify({ barracks: 1 })]);
    expect(rec.rows[0].r.status).toBe("recruited");
    const a = await army(profileId);
    expect(a).toEqual({ infantry: 10 });
    const fords = await one<Record<string, never>>("select * from territories where game_profile_id = $1 and territory_code = 'river_fords'", [profileId]);
    const fight = resolveBattle({ army: a, morale: 80, commander: "self", strategy: 10, tactic: "balanced", target: { terrain: fords.terrain_type, garrison: fords.garrison_strength, fortification: fords.fortification_level, resource: fords.resource_type }, seed: 5 });
    expect(fight.win).toBe(true);
    const bt = await svc.query("select public.resolve_battle($1,'journey-attack','river_fords',$2,$3,$4) as r", [
      userId, JSON.stringify(a), fords.garrison_strength,
      JSON.stringify({ win: true, casualties: fight.casualties, garrison_after: fight.garrisonAfter, fortification_after: fight.fortificationAfter, rewards: fight.rewards, morale_after: fight.moraleAfter, seed: 5, tactic: "balanced" }),
    ]);
    expect(bt.rows[0].r.win).toBe(true);

    // Court: the first conversation.
    await ensureCourt(userId);
    const bram = await one<Record<string, number | string>>("select * from court_npcs where game_profile_id = $1 and npc_code = 'bram'", [profileId]);
    const talk = await svc.query("select public.court_interact($1,'journey-talk','bram','talk',$2,$3,$4) as r", [
      userId, DAY,
      JSON.stringify({ npcs: [{ code: "bram", expected_version: bram.version, stats: { loyalty: bram.loyalty, affection: Number(bram.affection) + 3, trust: Number(bram.trust) + 2, ambition: bram.ambition, jealousy: bram.jealousy, influence: bram.influence }, status: "ACQUAINTED", position: null }] }),
      JSON.stringify({ content: "Казна в порядке, правитель.", source: "FALLBACK" }),
    ]);
    expect(talk.rows[0].r.status).toBe("applied");

    // Story: chapter 1 from the intro to its completion, from that real progress.
    await svc.query("select public.ensure_story($1, 'ch1')", [userId]);
    await seen(userId, "ch1");
    expect(await metrics(profileId)).toMatchObject({ questsCompleted: 3, buildings: 1, battlesWon: 1, territories: 2 });
    await decide(userId, "journey-decide", "ch1", "workers");
    let won = false;
    for (const day of ["2026-11-20", "2026-11-21", "2026-11-22"]) {
      await svc.query("update kingdoms set command_points = greatest(command_points, 1) where game_profile_id = $1 and owner_type = 'HERO'", [profileId]);
      const { r } = await boss(userId, profileId, `journey-boss-${day}`, "ch1", day);
      if (r.win) {
        won = true;
        break;
      }
    }
    expect(won).toBe(true);
    expect((await complete(userId, "journey-complete", "ch1", "ch2")).status).toBe("completed");
    const list = JSON.stringify(ACHIEVEMENTS.map((x) => ({ code: x.code, name: x.name, metric: x.metric, target: x.target, title: x.title ?? null })));
    const ach = await one<{ r: { unlocked: string[] } }>("select public.grant_achievements($1, $2, $3) as r", [userId, list, W]);
    expect(ach.r.unlocked).toEqual(expect.arrayContaining(["first_quest", "first_building", "first_victory"]));
    // Story and battles gave resources, never XP.
    expect(Number((await one("select total_xp from game_profiles where id = $1", [profileId])).total_xp)).toBe(xp);

    // Reconnect: a fresh browser session sees exactly the same state through RLS.
    const snapshot = async (c: Client) => ({
      profile: (await c.query("select level, total_xp, current_chapter from game_profiles")).rows,
      kingdom: (await c.query("select gold, food, influence, command_points from kingdoms where owner_type = 'HERO'")).rows,
      story: (await c.query("select chapter_code, status, decision, boss_defeated from story_progress order by chapter_code")).rows,
      items: (await c.query("select item_code from inventory_items order by item_code")).rows,
      achievements: (await c.query("select achievement_code from achievements order by achievement_code")).rows,
      territories: (await c.query("select territory_code from territories where owner_type = 'HERO' order by territory_code")).rows,
      court: (await c.query("select npc_code, relationship_status from court_npcs order by npc_code")).rows,
    });
    const first = await userClient(url, userId);
    const before = await snapshot(first);
    await first.end();
    const second = await userClient(url, userId);
    const after = await snapshot(second);
    await second.end();
    expect(after).toEqual(before);
    expect(before.story).toEqual([
      { chapter_code: "ch1", status: "COMPLETED", decision: "workers", boss_defeated: true },
      { chapter_code: "ch2", status: "ACTIVE", decision: null, boss_defeated: false },
    ]);
    expect(before.items.map((x) => x.item_code)).toEqual(["bandit_banner", "father_seal"]);
    expect(before.territories.map((x) => x.territory_code)).toEqual(["capital", "river_fords"]);
  });
});
