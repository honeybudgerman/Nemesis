import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { NPCS, STARTING_RELATIONS } from "@/data/court/npcs";
import { STARTING_HERO_STATS, STARTING_RESOURCES } from "@/data/kingdom";
import { SKILL_CODES } from "@/data/skills";
import { createTestDatabase, TEST_DATABASE_URL, userClient } from "./db";

const run = TEST_DATABASE_URL ? describe : describe.skip;

run("romance phase 2 migration", () => {
  it("upgrades an existing partner and event history and keeps client writes forbidden", async () => {
    const legacy = await createTestDatabase("20261121000100_romance_second_chances.sql");
    const db = new Client({ connectionString: legacy.url });
    await db.connect();
    try {
      const userId = randomUUID();
      await db.query("insert into auth.users (id, email) values ($1,$2)", [userId, `${userId}@test.local`]);
      const started = await db.query("select public.start_game($1,$2,$3,$4,$5,$6,$7,$8,$9) as r", [
        userId, "Игорь", "UTC", 55, "Субару", "Алый лотос", [...SKILL_CODES], JSON.stringify(STARTING_RESOURCES), JSON.stringify(STARTING_HERO_STATS),
      ]);
      const profileId: string = started.rows[0].r.profile_id;
      const seed = NPCS.map((n) => ({ code: n.code, name: n.name, age: n.age, role: n.role, positions: n.positions, stats: n.start, recruited: !n.joins }));
      await db.query("select public.ensure_court($1,$2,$3)", [userId, JSON.stringify(seed), JSON.stringify(STARTING_RELATIONS)]);
      await db.query("update court_npcs set relationship_status = 'PARTNER', affection = 81, trust = 74, version = 12 where game_profile_id = $1 and npc_code = 'liara'", [profileId]);
      await db.query("insert into game_events (game_profile_id, event_type, payload, created_at) values ($1, 'COURT_RELATIONSHIP', $2, '2026-10-01T12:00:00Z')", [profileId, JSON.stringify({ npc: "liara", from: "ROMANCE", to: "PARTNER" })]);
      const old = await db.query("insert into court_events (game_profile_id,event_code,event_day,status,resolved_day,selected_choice,outcome) values ($1,'liara_3','2026-10-01','RESOLVED','2026-10-01','trade',$2) returning id", [profileId, JSON.stringify({ text: "Сохранённый договор" })]);
      await db.query(readFileSync(join(__dirname, "../../supabase/migrations/20261122000100_romance_life.sql"), "utf8"));
      const npc = await db.query("select relationship_status, affection, trust, version, status_since_day::text, absent_until_day from court_npcs where game_profile_id = $1 and npc_code = 'liara'", [profileId]);
      expect(npc.rows[0]).toEqual({ relationship_status: "PARTNER", affection: 81, trust: 74, version: 12, status_since_day: "2026-10-01", absent_until_day: null });
      expect((await db.query("select id, outcome->>'text' as text from court_events where id = $1", [old.rows[0].id])).rows[0]).toEqual({ id: old.rows[0].id, text: "Сохранённый договор" });
      const user = await userClient(legacy.url, userId);
      try {
        await expect(user.query("update court_npcs set absent_until_day = current_date")).rejects.toThrow(/permission denied/);
        await expect(user.query("select * from court_event_rules")).rejects.toThrow(/permission denied/);
        await expect(user.query("select public.open_court_event_with_mode($1,current_date,'liara_partner_evening','{}','[]',2,false)", [userId])).rejects.toThrow(/permission denied/);
      } finally {
        await user.end();
      }
    } finally {
      await db.end();
      await legacy.drop();
    }
  });
});
