import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STARTING_HERO_STATS, STARTING_RESOURCES } from "@/data/kingdom";
import { SKILL_CODES } from "@/data/skills";
import { aiQuestPlanSchema, normalizeQuestPlan } from "@/engine/ai/mentor";
import { planDailyQuests } from "@/engine/quests/planner";
import { createTestDatabase, serviceClient, TEST_DATABASE_URL, userClient } from "./db";

const run = TEST_DATABASE_URL ? describe : describe.skip;

const TODAY = new Date().toISOString().slice(0, 10);
const DEADLINE = new Date(Date.now() + 12 * 3600_000);
const DAY_START = new Date(Date.now() - 3600_000).toISOString();
const MONTH_START = new Date(Date.now() - 5 * 86400_000).toISOString();

const PLAN = aiQuestPlanSchema.parse({
  quests: [
    { title: "Английский: 10 фраз", category: "english", duration_minutes: 20, difficulty: 2, instructions: "Выучи", evaluation_mode: "AI_REVIEW", success_criteria: ["3 предложения"], optional: false },
    { title: "Разбор графика", category: "trading_analysis", duration_minutes: 20, difficulty: 3, instructions: "Разбери", evaluation_mode: "AI_REVIEW", success_criteria: ["уровни"], optional: false },
    { title: "План дня", category: "time_management", duration_minutes: 15, difficulty: 2, instructions: "Распиши", evaluation_mode: "SELF_REPORT", success_criteria: ["план"], optional: false },
    { title: "Прогулка", category: "discipline", duration_minutes: 20, difficulty: 1, instructions: "Пройдись", evaluation_mode: "SELF_REPORT", success_criteria: ["без телефона"], optional: true },
  ],
});

run("database: mentor Orion", () => {
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

  async function newPlayer() {
    const userId = randomUUID();
    const c = await serviceClient(url);
    await c.query("reset role");
    await c.query("insert into auth.users (id, email) values ($1, $2)", [userId, `${userId}@test.local`]);
    await c.end();
    const { rows } = await svc.query("select public.start_game($1,$2,$3,$4,$5,$6,$7,$8,$9) as r", [
      userId, "Игорь", "UTC", 55, "Арен", "Северная марка", [...SKILL_CODES],
      JSON.stringify(STARTING_RESOURCES), JSON.stringify(STARTING_HERO_STATS),
    ]);
    const profileId: string = rows[0].r.profile_id;
    const planned = planDailyQuests(profileId, TODAY, 55, DEADLINE).map((q) => ({
      template_code: q.templateCode, title: q.title, description: q.description, category: q.category,
      frequency: q.frequency, difficulty: q.difficulty, estimated_minutes: q.estimatedMinutes, base_xp: q.baseXp,
      is_optional: q.isOptional, success_criteria: q.successCriteria, scheduled_date: q.scheduledDate,
      deadline_at: q.deadlineAt, evaluation_mode: q.evaluationMode,
    }));
    await svc.query("select public.sync_quests($1, $2)", [userId, JSON.stringify(planned)]);
    return { userId, profileId, planned };
  }

  const reserve = async (userId: string, client: Client = svc) =>
    (await client.query("select public.reserve_ai_request($1, 'MENTOR_CHAT', $2, $3) as r", [userId, DAY_START, MONTH_START])).rows[0].r as {
      status: string; id?: string; reason?: string;
    };

  const finish = (userId: string, id: string, cost: number) =>
    svc.query("select public.finish_ai_request($1, $2, 'OK', 'test/model', 100, 50, $3, 1, null)", [userId, id, cost]);

  const applyPlan = async (userId: string) =>
    (await svc.query("select public.apply_ai_daily_quests($1, $2, $3) as r", [userId, TODAY, JSON.stringify(normalizeQuestPlan(PLAN, 55, DEADLINE))])).rows[0].r as {
      status: string; replaced?: number; inserted?: number;
    };

  it("enforces the daily request limit, also under concurrent requests", async () => {
    const { userId } = await newPlayer();
    await svc.query("select public.update_ai_settings($1, 3, 300)", [userId]);
    const clients = await Promise.all(Array.from({ length: 6 }, () => serviceClient(url)));
    const results = await Promise.all(clients.map((c) => reserve(userId, c)));
    await Promise.all(clients.map((c) => c.end()));
    expect(results.filter((r) => r.status === "ok")).toHaveLength(3);
    expect(results.filter((r) => r.status === "limited" && r.reason === "daily")).toHaveLength(3);
  });

  it("stops at the monthly budget; a zero budget turns AI off", async () => {
    const { userId } = await newPlayer();
    await svc.query("select public.update_ai_settings($1, 50, 1)", [userId]); // $0.01
    const a = await reserve(userId);
    expect(a.status).toBe("ok");
    await finish(userId, a.id!, 10_000); // exactly $0.01
    expect(await reserve(userId)).toMatchObject({ status: "limited", reason: "budget" });

    const other = await newPlayer();
    await svc.query("select public.update_ai_settings($1, 50, 0)", [other.userId]);
    expect(await reserve(other.userId)).toMatchObject({ status: "limited", reason: "budget" });
  });

  it("finish_ai_request records usage once and only for the owner", async () => {
    const a = await newPlayer();
    const b = await newPlayer();
    const r = await reserve(a.userId);
    await svc.query("select public.finish_ai_request($1, $2, 'OK', 'x', 1, 1, 999, 1, null)", [b.userId, r.id]);
    let row = (await svc.query("select status, cost_micros from ai_usage_logs where id = $1", [r.id])).rows[0];
    expect(row).toMatchObject({ status: "PENDING", cost_micros: "0" });
    await finish(a.userId, r.id!, 1234);
    await finish(a.userId, r.id!, 9999); // second finish is ignored
    row = (await svc.query("select status, cost_micros, prompt_tokens from ai_usage_logs where id = $1", [r.id])).rows[0];
    expect(row).toMatchObject({ status: "OK", cost_micros: "1234", prompt_tokens: 100 });
  });

  it("Orion's plan replaces today's template quests once, and templates are not re-issued", async () => {
    const { userId, profileId, planned } = await newPlayer();
    const first = await applyPlan(userId);
    expect(first).toMatchObject({ status: "applied", replaced: 4, inserted: 4 });
    expect((await applyPlan(userId)).status).toBe("exists");

    await svc.query("select public.sync_quests($1, $2)", [userId, JSON.stringify(planned.map((q) => ({ ...q })))]);
    const { rows } = await svc.query(
      "select source, status, count(*)::int as n from quests where game_profile_id = $1 and frequency = 'DAILY' group by 1, 2 order by 1, 2",
      [profileId],
    );
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        { source: "TEMPLATE", status: "REPLACED", n: 4 },
        { source: "AI", status: "PENDING", n: 4 },
      ]),
    );

    // A replaced quest can never be completed.
    const { rows: rep } = await svc.query("select id from quests where game_profile_id = $1 and status = 'REPLACED' limit 1", [profileId]);
    const r = await svc.query("select public.complete_quest($1, $2, 'replaced-key-1', 'A', 10, 5, 0, null, 60, $3) as r", [userId, rep[0].id, DAY_START]).then(
      (x) => x.rows[0].r,
      (e: Error) => ({ error: e.message }),
    );
    expect(JSON.stringify(r)).toMatch(/QUEST_NOT_PENDING|not_pending|error/i);
    const { rows: done } = await svc.query("select count(*)::int as n from quest_completions where quest_id = $1", [rep[0].id]);
    expect(done[0].n).toBe(0);
  });

  it("refuses a plan once a daily quest was already closed (no reward re-rolls)", async () => {
    const { userId, profileId } = await newPlayer();
    const { rows } = await svc.query("select id from quests where game_profile_id = $1 and frequency = 'DAILY' limit 1", [profileId]);
    await svc.query("select public.skip_quest($1, $2)", [userId, rows[0].id]);
    expect((await applyPlan(userId)).status).toBe("too_late");
    const { rows: ai } = await svc.query("select count(*)::int as n from quests where game_profile_id = $1 and source = 'AI'", [profileId]);
    expect(ai[0].n).toBe(0);
  });

  it("keeps the first evaluation of a quest and rejects closed or foreign quests", async () => {
    const a = await newPlayer();
    const b = await newPlayer();
    await applyPlan(a.userId);
    const { rows } = await svc.query(
      "select id from quests where game_profile_id = $1 and source = 'AI' and evaluation_mode = 'AI_REVIEW' order by template_code limit 2",
      [a.profileId],
    );
    const save = (userId: string, questId: string, grade: string) =>
      svc.query("select public.save_quest_evaluation($1, $2, 'my answer', $3) as r", [
        userId, questId, JSON.stringify({ grade, reasoning: "ok", mistakes: [], recommendations: [], next_topic: "x" }),
      ]);
    const first = (await save(a.userId, rows[0].id, "B")).rows[0].r;
    const again = (await save(a.userId, rows[0].id, "S")).rows[0].r;
    expect(again.id).toBe(first.id);
    expect(again.grade).toBe("B");

    await expect(save(b.userId, rows[1].id, "S")).rejects.toThrow(/QUEST_NOT_FOUND/);
    await svc.query("select public.skip_quest($1, $2)", [a.userId, rows[1].id]);
    await expect(save(a.userId, rows[1].id, "S")).rejects.toThrow(/QUEST_NOT_PENDING/);
  });

  it("stores chat lines in order", async () => {
    const { userId, profileId } = await newPlayer();
    await svc.query("select public.add_mentor_messages($1, $2)", [
      userId,
      JSON.stringify([
        { role: "user", content: "Привет", source: "USER" },
        { role: "mentor", content: "Здравствуй", source: "AI" },
      ]),
    ]);
    const { rows } = await svc.query("select role, content from mentor_messages where game_profile_id = $1 order by created_at", [profileId]);
    expect(rows).toEqual([
      { role: "user", content: "Привет" },
      { role: "mentor", content: "Здравствуй" },
    ]);
  });

  it("RLS: players read only their own mentor data and cannot write or call AI functions", async () => {
    const a = await newPlayer();
    const b = await newPlayer();
    await reserve(a.userId);
    await reserve(b.userId);
    await svc.query("select public.add_mentor_messages($1, $2)", [b.userId, JSON.stringify([{ role: "user", content: "секрет", source: "USER" }])]);

    const ua = await userClient(url, a.userId);
    try {
      expect((await ua.query("select count(*)::int as n from ai_usage_logs")).rows[0].n).toBe(1);
      expect((await ua.query("select count(*)::int as n from mentor_messages")).rows[0].n).toBe(0);
      await expect(ua.query("insert into mentor_messages (game_profile_id, role, content) values ($1, 'mentor', 'x')", [a.profileId])).rejects.toThrow(/permission denied/);
      await expect(ua.query("update ai_usage_logs set cost_micros = 0")).rejects.toThrow(/permission denied/);
      await expect(ua.query("update users set ai_daily_request_limit = 200")).rejects.toThrow(/permission denied/);
      for (const sql of [
        "select public.reserve_ai_request($1, 'MENTOR_CHAT', now(), now())",
        "select public.update_ai_settings($1, 200, 10000)",
        "select public.add_mentor_messages($1, '[]'::jsonb)",
        "select public.apply_ai_daily_quests($1, current_date, '[]'::jsonb)",
      ]) {
        await expect(ua.query(sql, [a.userId])).rejects.toThrow(/permission denied/);
      }
    } finally {
      await ua.end();
    }
  });

  it("validates AI limits in the database too", async () => {
    const { userId } = await newPlayer();
    await expect(svc.query("select public.update_ai_settings($1, 500, 300)", [userId])).rejects.toThrow(/check/);
    await expect(svc.query("select public.update_ai_settings($1, 10, -1)", [userId])).rejects.toThrow(/check/);
  });
});
