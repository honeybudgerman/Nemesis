import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STARTING_HERO_STATS, STARTING_RESOURCES } from "@/data/kingdom";
import { SKILL_CODES } from "@/data/skills";
import { planDailyQuests } from "@/engine/quests/planner";
import { levelForXp, rankForLevel, xpRequired } from "@/engine/progression/xp";
import { createTestDatabase, serviceClient, TEST_DATABASE_URL, userClient } from "./db";

const run = TEST_DATABASE_URL ? describe : describe.skip;

run("database: progression, quests, RLS", () => {
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

  async function newUser(): Promise<string> {
    const id = randomUUID();
    const c = await serviceClient(url);
    await c.query("reset role");
    await c.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id}@test.local`]);
    await c.end();
    return id;
  }

  async function startGame(userId: string) {
    const { rows } = await svc.query(
      "select public.start_game($1, $2, $3, $4, $5, $6, $7, $8, $9) as r",
      [
        userId,
        "Игорь",
        "Europe/Moscow",
        55,
        "Арен",
        "Северная марка",
        [...SKILL_CODES],
        JSON.stringify(STARTING_RESOURCES),
        JSON.stringify(STARTING_HERO_STATS),
      ],
    );
    return rows[0].r as { profile_id: string; created: boolean };
  }

  async function syncToday(userId: string, profileId: string) {
    const deadline = new Date(Date.now() + 24 * 3600 * 1000);
    const planned = planDailyQuests(profileId, "2026-11-14", 55, deadline).map((q) => ({
      template_code: q.templateCode,
      title: q.title,
      description: q.description,
      category: q.category,
      frequency: q.frequency,
      difficulty: q.difficulty,
      estimated_minutes: q.estimatedMinutes,
      base_xp: q.baseXp,
      is_optional: q.isOptional,
      success_criteria: q.successCriteria,
      scheduled_date: q.scheduledDate,
      deadline_at: q.deadlineAt,
      evaluation_mode: q.evaluationMode,
    }));
    const { rows } = await svc.query("select public.sync_quests($1, $2) as r", [userId, JSON.stringify(planned)]);
    return rows[0].r as { inserted: number; expired: number };
  }

  async function complete(userId: string, questId: string, key: string, xp: number, client: Client = svc) {
    const { rows } = await client.query(
      "select public.complete_quest($1, $2, $3, 'A', $4, $5, $6, null, 60, $7) as r",
      [userId, questId, key, xp, Math.floor(xp / 2), 0, new Date(Date.now() - 3600_000).toISOString()],
    );
    return rows[0].r as Record<string, unknown>;
  }

  it("SQL progression math matches the TypeScript engine", async () => {
    const { rows: req } = await svc.query(
      "select l, public.nemesis_xp_required(l) as xp from generate_series(1, 300) l",
    );
    for (const r of req) expect(r.xp).toBe(xpRequired(r.l));

    const samples = [0, 1, 99, 100, 101, 382, 383, 902, 903, 5000, 123456, 9_999_999];
    for (let i = 0; i < 300; i++) samples.push(Math.floor(Math.random() * 2_000_000));
    const { rows } = await svc.query(
      "select x::bigint as x, public.nemesis_level_for_xp(x) as lvl from unnest($1::bigint[]) x",
      [samples],
    );
    for (const r of rows) expect(r.lvl).toBe(levelForXp(Number(r.x)));

    const { rows: ranks } = await svc.query(
      "select l, public.nemesis_rank_for_level(l) as rank from generate_series(1, 60) l",
    );
    for (const r of ranks) expect(r.rank).toBe(rankForLevel(r.l));
  });

  it("start_game creates the starting state and is idempotent", async () => {
    const user = await newUser();
    const first = await startGame(user);
    expect(first.created).toBe(true);
    const second = await startGame(user);
    expect(second).toEqual({ profile_id: first.profile_id, created: false });

    const { rows: k } = await svc.query("select * from kingdoms where game_profile_id = $1", [first.profile_id]);
    expect(k).toHaveLength(1);
    expect(Number(k[0].gold)).toBe(500);
    expect(Number(k[0].food)).toBe(200);
    expect(k[0].command_points).toBe(3);

    const { rows: skills } = await svc.query("select count(*)::int as n from skills where game_profile_id = $1", [
      first.profile_id,
    ]);
    expect(skills[0].n).toBe(6);

    const { rows: ledger } = await svc.query(
      "select resource, delta from resource_ledger where game_profile_id = $1 order by resource",
      [first.profile_id],
    );
    expect(ledger.map((l) => l.resource).sort()).toEqual(["command_points", "food", "gold"]);
  });

  it("sync_quests inserts once per period", async () => {
    const user = await newUser();
    const { profile_id } = await startGame(user);
    expect((await syncToday(user, profile_id)).inserted).toBe(4);
    expect((await syncToday(user, profile_id)).inserted).toBe(0);
  });

  it("complete_quest awards XP once, even when replayed or raced", async () => {
    const user = await newUser();
    const { profile_id } = await startGame(user);
    await syncToday(user, profile_id);
    const { rows: qs } = await svc.query(
      "select id, base_xp from quests where game_profile_id = $1 and not is_optional order by title",
      [profile_id],
    );

    const key = randomUUID();
    const first = await complete(user, qs[0].id, key, qs[0].base_xp);
    expect(first.status).toBe("completed");
    expect(first.awarded_xp).toBe(qs[0].base_xp);

    // Same request replayed (e.g. network retry) → no second award.
    const replay = await complete(user, qs[0].id, key, qs[0].base_xp);
    expect(replay.status).toBe("duplicate");

    // New key for the same quest → rejected.
    await expect(complete(user, qs[0].id, randomUUID(), qs[0].base_xp)).rejects.toThrow(/QUEST_ALREADY_COMPLETED/);

    // Two concurrent requests with different keys for another quest → exactly one award.
    const c1 = await serviceClient(url);
    const c2 = await serviceClient(url);
    const results = await Promise.allSettled([
      complete(user, qs[1].id, randomUUID(), qs[1].base_xp, c1),
      complete(user, qs[1].id, randomUUID(), qs[1].base_xp, c2),
    ]);
    await c1.end();
    await c2.end();
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);

    const { rows: p } = await svc.query("select total_xp, level from game_profiles where id = $1", [profile_id]);
    const expected = qs[0].base_xp + qs[1].base_xp;
    expect(Number(p[0].total_xp)).toBe(expected);
    expect(p[0].level).toBe(levelForXp(expected));

    const { rows: n } = await svc.query("select count(*)::int as n from quest_completions where game_profile_id = $1", [
      profile_id,
    ]);
    expect(n[0].n).toBe(2);

    const { rows: g } = await svc.query("select gold from kingdoms where game_profile_id = $1", [profile_id]);
    expect(Number(g[0].gold)).toBe(500 + Math.floor(qs[0].base_xp / 2) + Math.floor(qs[1].base_xp / 2));
  });

  it("levels up and records a LEVEL_UP event", async () => {
    const user = await newUser();
    const { profile_id } = await startGame(user);
    await syncToday(user, profile_id);
    const { rows: qs } = await svc.query("select id from quests where game_profile_id = $1 limit 1", [profile_id]);
    const r = await complete(user, qs[0].id, randomUUID(), 150);
    expect(r.level).toBe(2);
    expect(r.leveled_up).toBe(true);
    const { rows: ev } = await svc.query(
      "select payload from game_events where game_profile_id = $1 and event_type = 'LEVEL_UP'",
      [profile_id],
    );
    expect(ev[0].payload).toMatchObject({ from: 1, to: 2 });
  });

  it("caps daily XP from manual quests", async () => {
    const user = await newUser();
    await startGame(user);
    const dayStart = new Date(Date.now() - 3600_000).toISOString();
    const quest = (title: string) =>
      JSON.stringify({
        title,
        category: "discipline",
        difficulty: 3,
        estimated_minutes: 30,
        base_xp: 54,
        scheduled_date: "2026-11-14",
        deadline_at: new Date(Date.now() + 3600_000).toISOString(),
      });
    const ids: string[] = [];
    for (const t of ["a", "b", "c"]) {
      const { rows } = await svc.query("select public.create_manual_quest($1, $2, $3, 3) as id", [
        user,
        quest(t),
        dayStart,
      ]);
      ids.push(rows[0].id);
    }
    await expect(
      svc.query("select public.create_manual_quest($1, $2, $3, 3)", [user, quest("d"), dayStart]),
    ).rejects.toThrow(/MANUAL_QUEST_LIMIT/);

    const a = await complete(user, ids[0], randomUUID(), 54);
    const b = await complete(user, ids[1], randomUUID(), 54);
    const c = await complete(user, ids[2], randomUUID(), 54);
    expect([a.awarded_xp, b.awarded_xp, c.awarded_xp]).toEqual([54, 6, 0]);
  });

  it("skip gives nothing and is idempotent; expired quests cannot be completed", async () => {
    const user = await newUser();
    const { profile_id } = await startGame(user);
    await syncToday(user, profile_id);
    const { rows: qs } = await svc.query("select id from quests where game_profile_id = $1 order by title", [
      profile_id,
    ]);
    const s1 = await svc.query("select public.skip_quest($1, $2) as r", [user, qs[0].id]);
    expect(s1.rows[0].r.status).toBe("skipped");
    const s2 = await svc.query("select public.skip_quest($1, $2) as r", [user, qs[0].id]);
    expect(s2.rows[0].r.status).toBe("duplicate");
    await expect(complete(user, qs[0].id, randomUUID(), 10)).rejects.toThrow(/QUEST_NOT_PENDING/);

    const admin = await serviceClient(url);
    await admin.query("reset role");
    await admin.query("update quests set deadline_at = now() - interval '1 minute' where id = $1", [qs[1].id]);
    await admin.end();
    const r = await complete(user, qs[1].id, randomUUID(), 10);
    expect(r.status).toBe("expired");
    const { rows: p } = await svc.query("select total_xp from game_profiles where id = $1", [profile_id]);
    expect(Number(p[0].total_xp)).toBe(0);
  });

  it("RLS: users read only their own data and cannot write or call game functions", async () => {
    const alice = await newUser();
    const bob = await newUser();
    const a = await startGame(alice);
    await startGame(bob);
    await syncToday(alice, a.profile_id);

    const asBob = await userClient(url, bob);
    const { rows: seen } = await asBob.query("select id from game_profiles");
    expect(seen).toHaveLength(1);
    expect(seen[0].id).not.toBe(a.profile_id);
    const { rows: q } = await asBob.query("select id from quests where game_profile_id = $1", [a.profile_id]);
    expect(q).toHaveLength(0);

    await expect(asBob.query("update game_profiles set total_xp = 999999")).rejects.toThrow(/permission denied/);
    await expect(
      asBob.query("insert into quest_completions (quest_id, game_profile_id, grade, awarded_xp, idempotency_key) values (gen_random_uuid(), gen_random_uuid(), 'A', 1, 'xxxxxxxx')"),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asBob.query("select public.complete_quest($1, gen_random_uuid(), 'k1234567', 'A', 1000, 0, 0, null, 60, now())", [
        bob,
      ]),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asBob.query("select public.start_game($1, 'x', 'UTC', 55, 'xx', 'yy', array['english'], '{}', '{}')", [bob]),
    ).rejects.toThrow(/permission denied/);
    await asBob.end();

    const anon = await serviceClient(url);
    await anon.query("set role anon");
    await expect(anon.query("select * from game_profiles")).rejects.toThrow(/permission denied/);
    await anon.end();
  });

  it("delete_game removes all user data", async () => {
    const user = await newUser();
    const { profile_id } = await startGame(user);
    await syncToday(user, profile_id);
    await svc.query("select public.delete_game($1)", [user]);
    const { rows } = await svc.query(
      "select (select count(*) from quests where game_profile_id = $1)::int + (select count(*) from kingdoms where game_profile_id = $1)::int as n",
      [profile_id],
    );
    expect(rows[0].n).toBe(0);
  });
});
