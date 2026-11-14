import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STARTING_HERO_STATS, STARTING_RESOURCES } from "@/data/kingdom";
import { KAEL, KAEL_STARTING_STATS, SIMULATION_BATCH_DAYS, SIMULATION_VERSION } from "@/data/rival/kael";
import { SKILL_CODES } from "@/data/skills";
import { levelForXp } from "@/engine/progression/xp";
import { simulateBatch } from "@/engine/simulation/rival";
import { buildApplyPayload, rivalStateFromRows, type RivalProfileRow } from "@/engine/simulation/rival-persistence";
import { addDays, formatLocalDate, parseLocalDate } from "@/lib/time";
import { createTestDatabase, serviceClient, TEST_DATABASE_URL, userClient } from "./db";

const run = TEST_DATABASE_URL ? describe : describe.skip;

const shift = (day: string, n: number) => formatLocalDate(addDays(parseLocalDate(day), n));

run("database: rival Kael", () => {
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

  async function newPlayer(): Promise<{ userId: string; profileId: string }> {
    const userId = randomUUID();
    const c = await serviceClient(url);
    await c.query("reset role");
    await c.query("insert into auth.users (id, email) values ($1, $2)", [userId, `${userId}@test.local`]);
    await c.end();
    const { rows } = await svc.query("select public.start_game($1,$2,$3,$4,$5,$6,$7,$8,$9) as r", [
      userId,
      "Игорь",
      "Europe/Moscow",
      55,
      "Арен",
      "Северная марка",
      [...SKILL_CODES],
      JSON.stringify(STARTING_RESOURCES),
      JSON.stringify(STARTING_HERO_STATS),
    ]);
    return { userId, profileId: rows[0].r.profile_id };
  }

  async function ensureRival(userId: string, startDay: string, seed = 4242) {
    const { rows } = await svc.query("select public.ensure_rival($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as r", [
      userId,
      KAEL.name,
      KAEL.kingdomName,
      JSON.stringify({
        discipline: KAEL.disciplineFactor,
        learning: KAEL.learningFactor,
        risk: KAEL.riskTolerance,
        dailyMinutes: KAEL.dailyMinutes,
      }),
      seed,
      SIMULATION_VERSION,
      startDay,
      [...SKILL_CODES],
      JSON.stringify(KAEL_STARTING_STATS),
      JSON.stringify(STARTING_RESOURCES),
    ]);
    return rows[0].r as { rival_id: string; created: boolean };
  }

  /** Mirrors rival-service.loadRivalState, reading as service_role. */
  async function loadState(profileId: string, client: Client = svc) {
    const { rows } = await client.query(
      "select id, name, discipline_factor, learning_factor, risk_tolerance, daily_minutes, level, total_xp, fatigue, " +
        "to_char(last_simulated_day, 'YYYY-MM-DD') as last_simulated_day, simulation_version, rng_seed " +
        "from rival_profiles where game_profile_id = $1",
      [profileId],
    );
    const row = rows[0] as RivalProfileRow;
    const { rows: skills } = await client.query(
      "select skill_code, xp from skills where game_profile_id = $1 and character_type = 'RIVAL'",
      [profileId],
    );
    const { rows: k } = await client.query("select gold from kingdoms where game_profile_id = $1 and owner_type = 'RIVAL'", [
      profileId,
    ]);
    return { row, state: rivalStateFromRows(row, skills, k[0].gold) };
  }

  async function apply(userId: string, expectedLastDay: string, payload: unknown, client: Client = svc) {
    const { rows } = await client.query("select public.apply_rival_days($1,$2,$3) as r", [
      userId,
      expectedLastDay,
      JSON.stringify(payload),
    ]);
    return rows[0].r as { status: string; days?: number; level?: number };
  }

  /** The same loop as rival-service.syncRival, without the batch-per-request limit. */
  async function catchUp(userId: string, profileId: string, today: string) {
    let batches = 0;
    for (;;) {
      const { row, state } = await loadState(profileId);
      const b = simulateBatch(state, row.last_simulated_day, today, SIMULATION_BATCH_DAYS);
      if (b.days.length === 0) return batches;
      const r = await apply(userId, row.last_simulated_day, buildApplyPayload(b.days, b.state));
      expect(r.status).toBe("applied");
      batches++;
    }
  }

  it("ensure_rival creates Kael once with his own stats, skills and kingdom", async () => {
    const { userId, profileId } = await newPlayer();
    const first = await ensureRival(userId, "2026-11-14");
    expect(first.created).toBe(true);
    const second = await ensureRival(userId, "2026-11-20", 999);
    expect(second).toEqual({ rival_id: first.rival_id, created: false });

    const { row } = await loadState(profileId);
    expect(row.last_simulated_day).toBe("2026-11-13");
    expect(Number(row.rng_seed)).toBe(4242);
    const { rows: counts } = await svc.query(
      `select
         (select count(*)::int from skills where game_profile_id = $1 and character_type = 'RIVAL') as skills,
         (select count(*)::int from character_stats where game_profile_id = $1 and character_type = 'RIVAL') as stats,
         (select count(*)::int from kingdoms where game_profile_id = $1 and owner_type = 'RIVAL') as kingdoms,
         (select count(*)::int from game_events where game_profile_id = $1 and event_type = 'RIVAL_APPEARED') as events`,
      [profileId],
    );
    expect(counts[0]).toEqual({ skills: SKILL_CODES.length, stats: 1, kingdoms: 1, events: 1 });
  });

  it.each([1, 7, 30, 365])("catches up %i missed days in bounded batches, matching the engine", async (n) => {
    const { userId, profileId } = await newPlayer();
    const start = "2025-06-01";
    await ensureRival(userId, start);
    const { state: initial } = await loadState(profileId);
    const today = shift(start, n);

    const batches = await catchUp(userId, profileId, today);
    expect(batches).toBe(Math.ceil(n / SIMULATION_BATCH_DAYS));

    // The DB ends up exactly where one uninterrupted engine run ends.
    const expected = simulateBatch(initial, shift(start, -1), today, 10_000);
    const { row, state } = await loadState(profileId);
    expect(row.last_simulated_day).toBe(shift(today, -1));
    expect(state.totalXp).toBe(expected.state.totalXp);
    expect(state.skillXp).toEqual(expected.state.skillXp);
    expect(state.gold).toBe(expected.state.gold);
    expect(state.fatigue).toBe(expected.state.fatigue);
    expect(row.level).toBe(levelForXp(expected.state.totalXp));

    const { rows: a } = await svc.query(
      "select count(distinct simulation_day)::int as days, coalesce(sum(xp_awarded),0)::int as xp from rival_actions where rival_id = $1",
      [row.id],
    );
    expect(a[0].days).toBe(n);
    expect(a[0].xp).toBe(expected.state.totalXp);

    // Gold ledger reconciles with the kingdom balance.
    const { rows: ledger } = await svc.query(
      `select coalesce(sum(l.delta),0)::bigint as total from resource_ledger l
         join kingdoms k on k.id = l.kingdom_id
        where k.game_profile_id = $1 and k.owner_type = 'RIVAL' and l.resource = 'gold'`,
      [profileId],
    );
    expect(Number(ledger[0].total)).toBe(state.gold);

    // A checkpoint is stored for the last day of every batch.
    const { rows: cp } = await svc.query("select count(*)::int as n from simulation_checkpoints where rival_id = $1", [row.id]);
    expect(cp[0].n).toBe(batches);

    // Nothing left: another pass is a no-op.
    expect(await catchUp(userId, profileId, today)).toBe(0);
  });

  it("a replayed or stale batch is rejected without double XP", async () => {
    const { userId, profileId } = await newPlayer();
    await ensureRival(userId, "2026-01-01");
    const { row, state } = await loadState(profileId);
    const b = simulateBatch(state, row.last_simulated_day, "2026-01-11", 31);
    const payload = buildApplyPayload(b.days, b.state);

    expect((await apply(userId, row.last_simulated_day, payload)).status).toBe("applied");
    expect((await apply(userId, row.last_simulated_day, payload)).status).toBe("stale");
    expect((await loadState(profileId)).state.totalXp).toBe(b.state.totalXp);
  });

  it("two concurrent catch-ups apply the batch exactly once", async () => {
    const { userId, profileId } = await newPlayer();
    await ensureRival(userId, "2026-02-01");
    const { row, state } = await loadState(profileId);
    const b = simulateBatch(state, row.last_simulated_day, "2026-03-01", 31);
    const payload = buildApplyPayload(b.days, b.state);

    const clients = await Promise.all([serviceClient(url), serviceClient(url), serviceClient(url)]);
    const results = await Promise.all(clients.map((c) => apply(userId, row.last_simulated_day, payload, c)));
    await Promise.all(clients.map((c) => c.end()));

    expect(results.filter((r) => r.status === "applied")).toHaveLength(1);
    expect(results.filter((r) => r.status === "stale")).toHaveLength(2);
    const { rows } = await svc.query("select coalesce(sum(xp_awarded),0)::int as xp from rival_actions where rival_id = $1", [row.id]);
    expect(rows[0].xp).toBe(b.state.totalXp);
  });

  it("rejects batches that skip days or use another simulation version", async () => {
    const { userId, profileId } = await newPlayer();
    await ensureRival(userId, "2026-04-01");
    const { row, state } = await loadState(profileId);
    const b = simulateBatch(state, row.last_simulated_day, "2026-04-05", 31);
    const gap = buildApplyPayload([b.days[0], b.days[2]], b.state);
    await expect(apply(userId, row.last_simulated_day, gap)).rejects.toThrow(/RIVAL_DAY_GAP/);

    const wrongVersion = { ...buildApplyPayload(b.days, b.state), version: SIMULATION_VERSION + 1 };
    expect((await apply(userId, row.last_simulated_day, wrongVersion)).status).toBe("stale");
    expect((await loadState(profileId)).state.totalXp).toBe(0);
  });

  it("records a level-up event when Kael levels up", async () => {
    const { userId, profileId } = await newPlayer();
    await ensureRival(userId, "2026-01-01");
    await catchUp(userId, profileId, "2026-02-15");
    const { row } = await loadState(profileId);
    expect(row.level).toBeGreaterThan(1);
    const { rows } = await svc.query(
      "select count(*)::int as n from game_events where game_profile_id = $1 and event_type = 'RIVAL_LEVEL_UP'",
      [profileId],
    );
    expect(rows[0].n).toBeGreaterThan(0);
  });

  it("RLS: players read only their own rival and cannot write or simulate", async () => {
    const a = await newPlayer();
    const b = await newPlayer();
    await ensureRival(a.userId, "2026-05-01");
    await ensureRival(b.userId, "2026-05-01");
    await catchUp(a.userId, a.profileId, "2026-05-05");

    const ua = await userClient(url, a.userId);
    try {
      const { rows: own } = await ua.query("select id from rival_profiles");
      expect(own).toHaveLength(1);
      const { rows: acts } = await ua.query("select count(*)::int as n from rival_actions");
      expect(acts[0].n).toBeGreaterThan(0);
      const { rows: cps } = await ua.query("select count(*)::int as n from simulation_checkpoints");
      expect(cps[0].n).toBe(1);

      const { rows: other } = await ua.query("select id from rival_profiles where game_profile_id = $1", [b.profileId]);
      expect(other).toHaveLength(0);

      await expect(ua.query("update rival_profiles set total_xp = 0")).rejects.toThrow(/permission denied/);
      await expect(ua.query("delete from rival_actions")).rejects.toThrow(/permission denied/);
      await expect(
        ua.query("select public.apply_rival_days($1, '2026-04-30', '{}'::jsonb)", [a.userId]),
      ).rejects.toThrow(/permission denied/);
      await expect(
        ua.query("select public.ensure_rival($1,'x','y','{}'::jsonb,1,1,'2026-01-01',array[]::text[],'{}'::jsonb,'{}'::jsonb)", [
          b.userId,
        ]),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await ua.end();
    }
  });

  it("delete_game removes the rival and its chronicle", async () => {
    const { userId, profileId } = await newPlayer();
    const { rival_id } = await ensureRival(userId, "2026-06-01");
    await catchUp(userId, profileId, "2026-06-04");
    await svc.query("select public.delete_game($1)", [userId]);
    const { rows } = await svc.query(
      `select (select count(*)::int from rival_profiles where id = $1) as r,
              (select count(*)::int from rival_actions where rival_id = $1) as a,
              (select count(*)::int from simulation_checkpoints where rival_id = $1) as c`,
      [rival_id],
    );
    expect(rows[0]).toEqual({ r: 0, a: 0, c: 0 });
  });
});
