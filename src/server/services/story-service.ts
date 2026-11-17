import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { updateCourtNames } from "@/data/court/npcs";
import { CHAPTERS, CHAPTER_BY_CODE, FIRST_QUESTS_SCENE, type ChapterDef, type SceneDef } from "@/data/story/chapters";
import { EMPTY_FACTS, PROGRESS_METRICS, type ProgressFacts } from "@/data/story/progress";
import { ACHIEVEMENTS, ITEM_BY_CODE, ITEMS, TITLE_BY_CODE, TITLES } from "@/data/story/rewards";
import type { Tactic } from "@/data/realm/units";
import { UNIT_TYPES } from "@/data/realm/units";
import { chronicleMessages, cleanChronicle } from "@/engine/ai/story";
import { armyPower, estimateRisk, resolveBattle, type Commander } from "@/engine/realm/battle";
import {
  bossBlocked,
  bossTarget,
  canComplete,
  chapterStage,
  choiceChanges,
  choiceBlocked,
  currentChapter,
  decisionBlocked,
  fillHero,
  itemEffects,
  nextChapterCode,
  objectiveStates,
  objectivesDone,
  speakerName,
  unitPowerWeights,
  walletText,
  type ChapterProgress,
} from "@/engine/story/story";
import { describeEvent, eventCategory } from "@/lib/events";
import { hashString } from "@/lib/random";
import { questPeriods } from "@/lib/time";
import { callAi } from "@/server/ai/gateway";
import { ApiError, fromDbError } from "@/server/http/errors";
import { generalOf, syncWorld, type Realm } from "@/server/services/realm-service";
import { getAdminSupabase } from "@/server/supabase/admin";
import type {
  AchievementView,
  BossOutcome,
  ChapterSummary,
  ChapterView,
  CompleteOutcome,
  DecisionOutcome,
  ItemView,
  SceneView,
  StoryScreen,
  TimelineItem,
  TitleView,
} from "@/types/story";

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getAdminSupabase().rpc(fn, args);
  if (error) throw fromDbError(error);
  return data as T;
}

interface ProgressRow {
  chapter_code: string;
  status: "ACTIVE" | "COMPLETED";
  intro_seen: boolean;
  outro_seen: boolean;
  decision: string | null;
  boss_defeated: boolean;
  boss_attempts: number;
  boss_last_attempt_day: string | null;
  chronicle: string | null;
  chronicle_source: "AI" | "FALLBACK" | null;
  started_at: string;
  completed_at: string | null;
}

interface Story {
  realm: Realm;
  today: string;
  heroName: string;
  kingdomName: string;
  activeTitle: string | null;
  rows: ProgressRow[];
  achievements: Map<string, string>;
  titles: Set<string>;
  facts: ProgressFacts;
  newAchievements: string[];
  events: { id: string; event_type: string; payload: Record<string, unknown>; created_at: string }[];
}

const toProgress = (r: ProgressRow): ChapterProgress => ({
  chapter: r.chapter_code,
  status: r.status,
  introSeen: r.intro_seen,
  decision: r.decision,
  bossDefeated: r.boss_defeated,
  bossLastAttemptDay: r.boss_last_attempt_day,
});

const objectivesPayload = (ch: ChapterDef) => ch.objectives.map((o) => ({ metric: o.metric, target: o.target }));
const achievementsPayload = () => ACHIEVEMENTS.map((a) => ({ code: a.code, name: a.name, metric: a.metric, target: a.target, title: a.title ?? null }));

async function loadRows(db: SupabaseClient, profileId: string): Promise<ProgressRow[]> {
  const { data, error } = await db.from("story_progress").select("*").eq("game_profile_id", profileId).order("started_at");
  if (error) throw fromDbError(error);
  return (data ?? []) as ProgressRow[];
}

/** Sync the world, start the story once, unlock earned achievements, then read everything. */
async function loadStory(db: SupabaseClient, userId: string): Promise<Story> {
  const { realm } = await syncWorld(db, userId, 1);
  const today = questPeriods(new Date(), realm.timezone).today;
  let rows = await loadRows(db, realm.profileId);
  if (rows.length === 0) {
    await rpc("ensure_story", { p_user_id: userId, p_first_chapter: CHAPTERS[0].code });
    rows = await loadRows(db, realm.profileId);
  }
  const granted = await rpc<{ unlocked: string[]; metrics: Record<string, number | string> }>("grant_achievements", {
    p_user_id: userId,
    p_list: achievementsPayload(),
    p_unit_power: unitPowerWeights(),
  });
  const facts: ProgressFacts = { ...EMPTY_FACTS };
  for (const m of PROGRESS_METRICS) facts[m] = Number(granted.metrics?.[m] ?? 0);

  const [p, a, t, e] = await Promise.all([
    db.from("game_profiles").select("hero_name, kingdom_name, active_title").eq("id", realm.profileId).maybeSingle<{ hero_name: string; kingdom_name: string; active_title: string | null }>(),
    db.from("achievements").select("achievement_code, unlocked_at").eq("game_profile_id", realm.profileId),
    db.from("unlocked_titles").select("title_code").eq("game_profile_id", realm.profileId),
    db.from("game_events").select("id, event_type, payload, created_at").eq("game_profile_id", realm.profileId).order("created_at", { ascending: false }).limit(80),
  ]);
  for (const x of [p, a, t, e]) if (x.error) throw fromDbError(x.error);
  return {
    realm,
    today,
    heroName: p.data?.hero_name ?? "Правитель",
    kingdomName: p.data?.kingdom_name ?? "",
    activeTitle: p.data?.active_title ?? null,
    rows,
    achievements: new Map(((a.data ?? []) as { achievement_code: string; unlocked_at: string }[]).map((x) => [x.achievement_code, x.unlocked_at])),
    titles: new Set(((t.data ?? []) as { title_code: string }[]).map((x) => x.title_code)),
    facts,
    newAchievements: granted.unlocked ?? [],
    events: (e.data ?? []) as Story["events"],
  };
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------
const wallet = (r: Realm) => ({ gold: r.kingdom.gold, food: r.kingdom.food, knowledge: r.kingdom.knowledge, influence: r.kingdom.influence });

function sceneView(s: SceneDef, hero: string): SceneView {
  return {
    code: s.code,
    title: s.title,
    backdrop: s.backdrop,
    lines: s.lines.map((l) => ({ speaker: l.speaker, name: speakerName(l.speaker, hero), text: fillHero(l.text, hero) })),
  };
}

function rewardsText(ch: ChapterDef): string[] {
  return [
    ...walletText(ch.rewards.resources, "+"),
    ...ch.rewards.items.map((i) => `${ITEM_BY_CODE[i]?.icon ?? ""} ${ITEM_BY_CODE[i]?.name ?? i}`.trim()),
    ...ch.rewards.titles.map((t) => `Титул «${TITLE_BY_CODE[t]?.name ?? t}»`),
  ];
}

function itemEffectText(code: string): string {
  const it = ITEM_BY_CODE[code];
  if (!it) return "";
  const parts = walletText(it.economy, "+").map((x) => `${x} в день`);
  if (it.battlePower) parts.push(`+${Math.round(it.battlePower * 100)}% к силе армии`);
  return parts.join(", ");
}

function chapterView(s: Story, ch: ChapterDef, row: ProgressRow): ChapterView {
  const p = toProgress(row);
  const r = s.realm;
  const w = wallet(r);
  const chosen = row.decision ? ch.decision.choices.find((c) => c.code === row.decision) : null;
  const general = generalOf(r);
  const bonus = itemEffects(r.items).battlePower;
  return {
    code: ch.code,
    number: ch.number,
    title: ch.title,
    summary: ch.summary,
    stage: chapterStage(ch, p, s.facts),
    objectives: objectiveStates(ch, s.facts),
    decision: {
      title: ch.decision.title,
      text: ch.decision.text,
      backdrop: ch.decision.backdrop,
      choices: ch.decision.choices.map((c) => ({
        code: c.code,
        label: c.label,
        effects: [
          ...walletText(c.gain, "+"),
          ...walletText(c.cost, "−"),
          ...(c.morale ? [`${c.morale > 0 ? "+" : "−"}${Math.abs(c.morale)} боевого духа`] : []),
        ],
        blocked: row.decision ? "Решение уже принято." : choiceBlocked(c, w),
      })),
      chosen: chosen ? { label: chosen.label, text: chosen.text } : null,
    },
    boss: ch.boss
      ? {
          code: ch.boss.code,
          name: ch.boss.name,
          title: ch.boss.title,
          text: ch.boss.text,
          backdrop: ch.boss.backdrop,
          speaker: ch.boss.speaker,
          defeated: row.boss_defeated,
          attempts: row.boss_attempts,
          blocked: bossBlocked(ch, p, s.facts, s.today, { commandPoints: r.kingdom.commandPoints, army: r.army }),
          risk: estimateRisk({
            army: r.army,
            morale: r.morale,
            commander: general && general.skill > r.strategy ? "general" : "self",
            strategy: general && general.skill > r.strategy ? general.skill : r.strategy,
            tactic: "balanced",
            powerBonus: bonus,
            target: bossTarget(ch),
          }),
          target: bossTarget(ch),
          rewards: walletText(ch.boss.rewards, "+"),
          item: ch.boss.item ? { name: ITEM_BY_CODE[ch.boss.item].name, icon: ITEM_BY_CODE[ch.boss.item].icon } : null,
        }
      : null,
    intro: sceneView(ch.intro, s.heroName),
    outro: sceneView(ch.outro, s.heroName),
    rewards: rewardsText(ch),
  };
}

function screenOf(s: Story): StoryScreen {
  const progress = s.rows.map(toProgress);
  const current = currentChapter(progress);
  const byCode = new Map(s.rows.map((r) => [r.chapter_code, r]));
  const currentRow = current ? byCode.get(current.code) : undefined;
  const unseenOutro = s.rows.find((r) => r.status === "COMPLETED" && !r.outro_seen);
  const r = s.realm;

  const chapters: ChapterSummary[] = CHAPTERS.map((c) => {
    const row = byCode.get(c.code);
    return {
      code: c.code,
      number: c.number,
      title: c.title,
      summary: c.summary,
      status: !row ? "locked" : row.status === "COMPLETED" ? "completed" : "active",
      decision: row?.decision ? (c.decision.choices.find((x) => x.code === row.decision)?.label ?? null) : null,
      chronicle: row?.chronicle ? updateCourtNames(row.chronicle) : null,
      chronicleSource: row?.chronicle_source ?? null,
      completedAt: row?.completed_at ?? null,
      outroSeen: row?.outro_seen ?? false,
      intro: row ? sceneView(c.intro, s.heroName) : null,
      outro: row?.status === "COMPLETED" ? sceneView(c.outro, s.heroName) : null,
    };
  });

  const achievements: AchievementView[] = ACHIEVEMENTS.map((a) => ({
    code: a.code,
    name: a.name,
    icon: a.icon,
    description: a.description,
    unlocked: s.achievements.has(a.code),
    unlockedAt: s.achievements.get(a.code) ?? null,
    progress: { current: Math.min(a.target, Math.floor(s.facts[a.metric] ?? 0)), target: a.target },
    title: a.title ? (TITLE_BY_CODE[a.title]?.name ?? null) : null,
  }));

  const titles: TitleView[] = TITLES.map((t) => ({ code: t.code, name: t.name, source: t.source, unlocked: s.titles.has(t.code), active: s.activeTitle === t.code }));
  const owned = new Set(r.items);
  const items: ItemView[] = ITEMS.map((i) => ({ code: i.code, name: i.name, icon: i.icon, description: i.description, effect: itemEffectText(i.code), owned: owned.has(i.code) }));

  const timeline: TimelineItem[] = s.events.map((e) => ({
    id: e.id,
    type: e.event_type,
    category: eventCategory(e.event_type),
    text: describeEvent({ id: e.id, type: e.event_type, payload: e.payload ?? {}, createdAt: e.created_at }),
    at: e.created_at,
  }));

  return {
    heroName: s.heroName,
    today: s.today,
    activeTitle: s.activeTitle && TITLE_BY_CODE[s.activeTitle] ? { code: s.activeTitle, name: TITLE_BY_CODE[s.activeTitle].name } : null,
    current: current && currentRow ? chapterView(s, current, currentRow) : null,
    pendingScene: unseenOutro
      ? { chapter: unseenOutro.chapter_code, scene: "outro" }
      : current && currentRow && !currentRow.intro_seen
        ? { chapter: current.code, scene: "intro" }
        : null,
    chapters,
    achievements,
    newAchievements: s.newAchievements,
    titles,
    items,
    timeline,
    army: { units: r.army, power: Math.round(armyPower(r.army)), morale: r.morale, commandPoints: r.kingdom.commandPoints },
    heroStrategy: r.strategy,
    general: generalOf(r),
    powerBonus: itemEffects(r.items).battlePower,
  };
}

export async function getStoryScreen(db: SupabaseClient, userId: string): Promise<StoryScreen> {
  return screenOf(await loadStory(db, userId));
}

/** Throne-room summary: never throws (the story must not take the throne room down). */
export async function getStorySummary(db: SupabaseClient, userId: string) {
  try {
    const s = await getStoryScreen(db, userId);
    return {
      chapter: s.current ? { number: s.current.number, title: s.current.title, stage: s.current.stage } : null,
      objectives: s.current?.objectives ?? [],
      questMilestone: s.current?.code === "ch1" && s.current.objectives.some((o) => o.code === "quests" && o.done)
        ? sceneView(FIRST_QUESTS_SCENE, s.heroName)
        : null,
      pendingScene: s.pendingScene != null,
      title: s.activeTitle?.name ?? null,
      newAchievements: s.newAchievements.map((c) => ACHIEVEMENTS.find((a) => a.code === c)?.name ?? c),
    };
  } catch (e) {
    console.error("story summary failed", e instanceof Error ? e.message : e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
function chapterOrThrow(code: string): ChapterDef {
  const ch = CHAPTER_BY_CODE[code];
  if (!ch) throw new ApiError("VALIDATION_ERROR", "Неизвестная глава.");
  return ch;
}

function rowOrThrow(s: Story, code: string): ProgressRow {
  const row = s.rows.find((r) => r.chapter_code === code);
  if (!row) throw new ApiError("STORY_LOCKED");
  return row;
}

export async function markSeen(db: SupabaseClient, userId: string, input: { chapter: string; scene: "intro" | "outro" }): Promise<StoryScreen> {
  chapterOrThrow(input.chapter);
  await rpc("story_mark_seen", { p_user_id: userId, p_chapter: input.chapter, p_scene: input.scene });
  return getStoryScreen(db, userId);
}

export async function decide(db: SupabaseClient, userId: string, input: { chapter: string; choice: string; idempotencyKey: string }): Promise<DecisionOutcome> {
  const ch = chapterOrThrow(input.chapter);
  const s = await loadStory(db, userId);
  const row = rowOrThrow(s, ch.code);
  const prior = await db.from("story_actions").select("result").eq("game_profile_id", s.realm.profileId).eq("idempotency_key", input.idempotencyKey).maybeSingle();
  if (prior.data) return { status: "duplicate", outcome: null, screen: screenOf(s) };

  const blocked = decisionBlocked(ch, toProgress(row), input.choice, wallet(s.realm));
  if (blocked) throw blocked.includes("ресурсов") ? new ApiError("INSUFFICIENT_RESOURCES") : blocked.includes("варианта") ? new ApiError("VALIDATION_ERROR", blocked) : new ApiError("STORY_LOCKED", blocked);
  const c = ch.decision.choices.find((x) => x.code === input.choice)!;
  const r = await rpc<{ status: "applied" | "duplicate" }>("story_choose", {
    p_user_id: userId,
    p_key: input.idempotencyKey,
    p_chapter: ch.code,
    p_choice: c.code,
    p_allowed: ch.decision.choices.map((x) => x.code),
    p_day: s.today,
    p_changes: choiceChanges(c),
    p_outcome: { title: ch.decision.title, choice: c.label },
  });
  const effects = [...walletText(c.gain, "+"), ...walletText(c.cost, "−"), ...(c.morale ? [`${c.morale > 0 ? "+" : "−"}${Math.abs(c.morale)} боевого духа`] : [])];
  return {
    status: r.status,
    outcome: r.status === "applied" ? { title: ch.decision.title, choice: c.label, text: c.text, effects } : null,
    screen: await getStoryScreen(db, userId),
  };
}

function bossError(reason: string): ApiError {
  if (reason.includes("цели")) return new ApiError("OBJECTIVES_INCOMPLETE");
  if (reason.includes("завтра")) return new ApiError("BOSS_COOLDOWN");
  if (reason.includes("командования")) return new ApiError("NO_COMMAND_POINTS");
  if (reason.includes("армии")) return new ApiError("NOT_ENOUGH_ARMY");
  return new ApiError("STORY_LOCKED", reason);
}

export async function attackBoss(
  db: SupabaseClient,
  userId: string,
  input: { chapter: string; tactic: Tactic; commander: Commander; idempotencyKey: string },
): Promise<BossOutcome> {
  const ch = chapterOrThrow(input.chapter);
  if (!ch.boss) throw new ApiError("STORY_LOCKED", "В этой главе нет босса.");
  let s = await loadStory(db, userId);
  const prior = await db.from("story_actions").select("result").eq("game_profile_id", s.realm.profileId).eq("idempotency_key", input.idempotencyKey).maybeSingle();
  if (prior.data) return { status: "duplicate", battle: null, screen: screenOf(s) };

  for (let attempt = 0; attempt < 3; attempt++) {
    const row = rowOrThrow(s, ch.code);
    const r = s.realm;
    const blocked = bossBlocked(ch, toProgress(row), s.facts, s.today, { commandPoints: r.kingdom.commandPoints, army: r.army });
    if (blocked) throw bossError(blocked);
    const general = generalOf(r);
    if (input.commander === "general" && !general) throw new ApiError("NO_COMMANDER");
    const seed = hashString(`boss:${r.profileId}:${input.idempotencyKey}`);
    const result = resolveBattle({
      army: r.army,
      morale: r.morale,
      commander: input.commander,
      strategy: input.commander === "general" ? general!.skill : r.strategy,
      tactic: input.tactic,
      powerBonus: itemEffects(r.items).battlePower,
      target: bossTarget(ch),
      seed,
    });
    const expectedArmy = Object.fromEntries(UNIT_TYPES.filter((u) => (r.army[u] ?? 0) > 0).map((u) => [u, r.army[u]]));
    const res = await rpc<{ status: "resolved" | "duplicate" | "stale"; win?: boolean }>("story_boss", {
      p_user_id: userId,
      p_key: input.idempotencyKey,
      p_chapter: ch.code,
      p_boss: ch.boss.code,
      p_day: s.today,
      p_objectives: objectivesPayload(ch),
      p_unit_power: unitPowerWeights(),
      p_expected_army: expectedArmy,
      p_battle: {
        win: result.win,
        casualties: result.casualties,
        morale_after: result.moraleAfter,
        seed,
        tactic: input.tactic,
        defender_side: ch.boss.defender,
        attacker_snapshot: { army: expectedArmy, morale: r.morale, commander: input.commander === "general" ? `npc:${general!.code}` : input.commander, power: result.attackerPower, bonus: itemEffects(r.items).battlePower },
        defender_snapshot: { name: ch.boss.name, ...ch.boss.target, power: result.defenderPower },
      },
      p_rewards: ch.boss.rewards,
      p_item: ch.boss.item ?? null,
    });
    if (res.status === "stale") {
      s = await loadStory(db, userId);
      continue;
    }
    return {
      status: res.status === "duplicate" ? "duplicate" : "resolved",
      battle:
        res.status === "resolved"
          ? {
              win: result.win,
              name: ch.boss.name,
              text: result.win ? ch.boss.victory : ch.boss.defeat,
              tactic: input.tactic,
              attackerPower: result.attackerPower,
              defenderPower: result.defenderPower,
              casualties: result.casualties,
              rewards: result.win ? [...walletText(ch.boss.rewards, "+"), ...(ch.boss.item ? [`${ITEM_BY_CODE[ch.boss.item].icon} ${ITEM_BY_CODE[ch.boss.item].name}`] : [])] : [],
            }
          : null,
      screen: await getStoryScreen(db, userId),
    };
  }
  throw new ApiError("RATE_LIMITED", "Состояние армии меняется слишком быстро. Повторите попытку.");
}

export async function completeChapter(db: SupabaseClient, userId: string, input: { chapter: string; idempotencyKey: string }): Promise<CompleteOutcome> {
  const ch = chapterOrThrow(input.chapter);
  const s = await loadStory(db, userId);
  const prior = await db.from("story_actions").select("result").eq("game_profile_id", s.realm.profileId).eq("idempotency_key", input.idempotencyKey).maybeSingle();
  if (prior.data) return { status: "duplicate", rewards: [], screen: screenOf(s) };
  const row = rowOrThrow(s, ch.code);
  if (!canComplete(ch, toProgress(row), s.facts)) {
    throw row.status === "ACTIVE" && row.intro_seen && !objectivesDone(ch, s.facts) ? new ApiError("OBJECTIVES_INCOMPLETE") : new ApiError("STORY_LOCKED");
  }
  const next = nextChapterCode(ch.code);
  const r = await rpc<{ status: "completed" | "duplicate" }>("story_complete_chapter", {
    p_user_id: userId,
    p_key: input.idempotencyKey,
    p_chapter: ch.code,
    p_objectives: objectivesPayload(ch),
    p_unit_power: unitPowerWeights(),
    p_requires_boss: Boolean(ch.boss),
    p_resources: ch.rewards.resources,
    p_items: ch.rewards.items,
    p_titles: ch.rewards.titles,
    p_next: next,
    p_next_number: next ? CHAPTER_BY_CODE[next].number : ch.number,
  });
  return { status: r.status, rewards: r.status === "completed" ? rewardsText(ch) : [], screen: await getStoryScreen(db, userId) };
}

export async function setTitle(db: SupabaseClient, userId: string, input: { title: string | null }): Promise<StoryScreen> {
  if (input.title && !TITLE_BY_CODE[input.title]) throw new ApiError("VALIDATION_ERROR", "Неизвестный титул.");
  await rpc("set_active_title", { p_user_id: userId, p_title: input.title });
  return getStoryScreen(db, userId);
}

/**
 * The chronicle of a completed chapter: written once by the AI chronicler
 * (or the scripted text when AI is unavailable) and then kept forever.
 */
export async function chapterChronicle(db: SupabaseClient, userId: string, input: { chapter: string }) {
  const ch = chapterOrThrow(input.chapter);
  const { realm } = await syncWorld(db, userId, 0);
  const rows = await loadRows(db, realm.profileId);
  const row = rows.find((r) => r.chapter_code === ch.code);
  if (!row || row.status !== "COMPLETED") throw new ApiError("STORY_LOCKED");
  if (row.chronicle) return { chronicle: updateCourtNames(row.chronicle), source: row.chronicle_source ?? "FALLBACK" };

  const [p, ev] = await Promise.all([
    db.from("game_profiles").select("hero_name, kingdom_name").eq("id", realm.profileId).maybeSingle<{ hero_name: string; kingdom_name: string }>(),
    db
      .from("game_events")
      .select("id, event_type, payload, created_at")
      .eq("game_profile_id", realm.profileId)
      .gte("created_at", row.started_at)
      .lte("created_at", row.completed_at ?? new Date().toISOString())
      .in("event_type", ["BATTLE_WON", "BOSS_DEFEATED", "COURT_EVENT", "TERRITORY_JOINED", "STORY_DECISION", "COURT_JOINED", "LEVEL_UP"])
      .order("created_at")
      .limit(8),
  ]);
  const hero = p.data?.hero_name ?? "Правитель";
  const decision = row.decision ? ch.decision.choices.find((c) => c.code === row.decision)?.label ?? null : null;
  const ai = await callAi(userId, realm.timezone, "STORY_CHRONICLE", {
    messages: chronicleMessages({
      heroName: hero,
      kingdomName: p.data?.kingdom_name ?? "",
      chapterNumber: ch.number,
      chapterTitle: ch.title,
      summary: ch.summary,
      decision,
      boss: ch.boss && row.boss_defeated ? `${ch.boss.name}, ${ch.boss.title}` : null,
      events: ((ev.data ?? []) as { id: string; event_type: string; payload: Record<string, unknown>; created_at: string }[]).map((e) =>
        describeEvent({ id: e.id, type: e.event_type, payload: e.payload ?? {}, createdAt: e.created_at }),
      ),
    }),
    maxTokens: 420,
    temperature: 0.7,
  }).catch(() => null);
  const text = ai && ai.ok && typeof ai.value === "string" ? cleanChronicle(ai.value) : null;
  const source = text ? "AI" : "FALLBACK";
  const saved = await rpc<{ chronicle: string }>("story_save_chronicle", {
    p_user_id: userId,
    p_chapter: ch.code,
    p_text: text ?? fillHero(ch.chronicle, hero),
    p_source: source,
  });
  // Another request may have written it first: whatever is stored wins.
  return { chronicle: updateCourtNames(saved.chronicle), source: saved.chronicle === text ? "AI" : saved.chronicle === fillHero(ch.chronicle, hero) ? "FALLBACK" : source };
}
