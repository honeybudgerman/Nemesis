import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EVENT_BY_CODE } from "@/data/court/events";
import {
  FALLBACK_LINES,
  INTERACTION_DEFS,
  INTERACTIONS,
  NPC_BY_CODE,
  NPCS,
  POSITION_DEFS,
  POSITIONS,
  STARTING_RELATIONS,
  STAT_LABELS,
  STATUS_LABELS,
  type Interaction,
  type NpcStat,
  type NpcStats,
  type Position,
  type RelationshipStatus,
} from "@/data/court/npcs";
import type { CourtFacts, NpcState, Wallet } from "@/data/court/types";
import { TERRITORIES } from "@/data/realm/map";
import { cleanDialogue, courtDialogueMessages } from "@/engine/ai/court";
import {
  assignBlocked,
  assignmentChanges,
  buildChanges,
  choiceBlocked,
  courtEconomyBonus,
  interactionBlocked,
  interactionDeltas,
  MAX_OPEN_EVENTS,
  mood,
  newcomers,
  pickDailyEvent,
  positionBonus,
  questLog,
  resolveChoice,
  type CourtChanges,
} from "@/engine/court/court";
import { hashString } from "@/lib/random";
import { questPeriods } from "@/lib/time";
import { callAi } from "@/server/ai/gateway";
import { ApiError, fromDbError } from "@/server/http/errors";
import { syncWorld, type Realm } from "@/server/services/realm-service";
import { getAdminSupabase } from "@/server/supabase/admin";
import type { ChoiceView, CourtEventView, CourtScreen, NpcCard, NpcDetail, OutcomeView, PositionView } from "@/types/court";

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getAdminSupabase().rpc(fn, args);
  if (error) throw fromDbError(error);
  return data as T;
}

const RESOURCE_WORDS: Record<keyof Wallet, string> = { gold: "золото", food: "провизия", knowledge: "знания", influence: "влияние" };

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------
interface NpcRow {
  id: string;
  npc_code: string;
  loyalty: number;
  affection: number;
  trust: number;
  ambition: number;
  jealousy: number;
  influence: number;
  relationship_status: RelationshipStatus;
  position: Position | null;
  recruited_at: string | null;
  last_interaction_day: string | null;
  version: number;
}

interface EventRow {
  id: string;
  event_code: string;
  event_day: string;
  status: "OPEN" | "RESOLVED";
  selected_choice: string | null;
  outcome: { title?: string; choice?: string; text?: string } | null;
  resolved_day: string | null;
}

interface Court {
  realm: Realm;
  today: string;
  heroName: string;
  facts: CourtFacts;
  rows: NpcRow[];
  events: EventRow[];
}

const statsOf = (r: NpcRow): NpcStats => ({ loyalty: r.loyalty, affection: r.affection, trust: r.trust, ambition: r.ambition, jealousy: r.jealousy, influence: r.influence });

function buildingLevels(realm: Realm) {
  const now = Date.now();
  const lvl = { palace: 0, academy: 0, barracks: 0, castle: 0 };
  for (const b of realm.buildings) {
    if (!(b.building_type in lvl)) continue;
    if (realm.territories.find((t) => t.territory_code === b.territoryCode)?.owner_type !== "HERO") continue;
    const done = b.construction_status === "COMPLETED" || Date.parse(b.completed_at) <= now ? b.level : b.level - 1;
    const k = b.building_type as keyof typeof lvl;
    lvl[k] = Math.max(lvl[k], done);
  }
  return lvl;
}

async function loadRows(db: SupabaseClient, profileId: string) {
  const [n, e] = await Promise.all([
    db.from("court_npcs").select("id, npc_code, loyalty, affection, trust, ambition, jealousy, influence, relationship_status, position, recruited_at, last_interaction_day, version").eq("game_profile_id", profileId),
    db.from("court_events").select("id, event_code, event_day, status, selected_choice, outcome, resolved_day").eq("game_profile_id", profileId).order("created_at"),
  ]);
  if (n.error) throw fromDbError(n.error);
  if (e.error) throw fromDbError(e.error);
  return { rows: (n.data ?? []) as NpcRow[], events: (e.data ?? []) as EventRow[] };
}

function factsOf(realm: Realm, today: string, heroName: string, heroLevel: number, rows: NpcRow[], events: EventRow[]): CourtFacts {
  const npcs: Record<string, NpcState> = {};
  for (const r of rows) {
    npcs[r.npc_code] = {
      code: r.npc_code,
      stats: statsOf(r),
      status: r.relationship_status,
      position: r.position,
      recruited: r.recruited_at != null,
      lastInteractionDay: r.last_interaction_day,
      version: r.version,
    };
  }
  return {
    day: today,
    heroName,
    heroLevel,
    npcs,
    resolved: Object.fromEntries(events.filter((e) => e.status === "RESOLVED").map((e) => [e.event_code, { choice: e.selected_choice ?? "", day: e.resolved_day ?? e.event_day }])),
    open: events.filter((e) => e.status === "OPEN").map((e) => e.event_code),
    territories: Object.fromEntries(realm.territories.map((t) => [t.territory_code, t.owner_type])),
    resources: { gold: realm.kingdom.gold, food: realm.kingdom.food, knowledge: realm.kingdom.knowledge, influence: realm.kingdom.influence },
    morale: realm.morale,
    buildings: buildingLevels(realm),
  };
}

/** Load the court; seed it once; let newcomers join; open today's event. */
async function loadCourt(db: SupabaseClient, userId: string, opts: { openEvent?: boolean } = {}): Promise<Court> {
  const { realm } = await syncWorld(db, userId, 1);
  const p = await db.from("game_profiles").select("hero_name, level").eq("id", realm.profileId).maybeSingle<{ hero_name: string; level: number }>();
  if (p.error) throw fromDbError(p.error);
  const heroName = p.data?.hero_name ?? "правитель";
  const today = questPeriods(new Date(), realm.timezone).today;

  let { rows, events } = await loadRows(db, realm.profileId);
  if (rows.length === 0) {
    await rpc("ensure_court", {
      p_user_id: userId,
      p_npcs: NPCS.map((n) => ({
        code: n.code,
        name: n.name,
        age: n.age,
        role: n.role,
        personality: { traits: n.traits, likes: n.likes, dislikes: n.dislikes },
        positions: n.positions,
        stats: n.start,
        recruited: !n.joins,
      })),
      p_relations: STARTING_RELATIONS,
    });
    ({ rows, events } = await loadRows(db, realm.profileId));
  }

  let facts = factsOf(realm, today, heroName, p.data?.level ?? 1, rows, events);
  const joining = newcomers(facts);
  if (joining.length > 0) {
    await rpc("court_recruit", { p_user_id: userId, p_codes: joining });
    ({ rows, events } = await loadRows(db, realm.profileId));
    facts = factsOf(realm, today, heroName, p.data?.level ?? 1, rows, events);
  }

  if (opts.openEvent) {
    const openedToday = events.some((e) => e.event_day === today);
    const pick = pickDailyEvent(facts, hashString(`court:${realm.profileId}:${today}`), openedToday);
    if (pick) {
      await rpc("open_court_event", {
        p_user_id: userId,
        p_day: today,
        p_code: pick.code,
        p_participants: pick.participants,
        p_choices: pick.choices.map((c) => ({ code: c.code, label: c.label })),
        p_max_open: MAX_OPEN_EVENTS,
      });
      ({ rows, events } = await loadRows(db, realm.profileId));
      facts = factsOf(realm, today, heroName, p.data?.level ?? 1, rows, events);
    }
  }
  return { realm, today, heroName, facts, rows, events };
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------
function card(c: Court, code: string): NpcCard {
  const def = NPC_BY_CODE[code];
  const n = c.facts.npcs[code];
  const quests = def.major ? questLog(c.facts, code) : [];
  return {
    code,
    name: def.name,
    age: def.age,
    role: def.role,
    title: def.title,
    major: def.major,
    romanceable: def.romanceable,
    recruited: n.recruited,
    joinHint: n.recruited ? null : (def.joins?.text ?? null),
    status: n.status,
    position: n.position,
    stats: n.stats,
    mood: mood(n.stats),
    interactedToday: n.lastInteractionDay === c.today,
    quest: def.major ? { done: quests.filter((q) => q.state === "done").length, total: quests.length } : null,
  };
}

function bonusText(b: Partial<Wallet>): string | null {
  const parts = (Object.keys(b) as (keyof Wallet)[]).filter((k) => (b[k] ?? 0) > 0).map((k) => `+${b[k]} ${RESOURCE_WORDS[k]} в день`);
  return parts.length ? parts.join(", ") : null;
}

function positionsView(c: Court): PositionView[] {
  return POSITIONS.map((position) => {
    const def = POSITION_DEFS[position];
    const holder = Object.values(c.facts.npcs).find((n) => n.position === position) ?? null;
    let bonus: string | null = null;
    if (holder) {
      if (position === "commander") {
        bonus = holder.stats.loyalty < 30 ? "Недостаточно лоялен, чтобы вести армию" : `Ведёт армию: военное дело ${NPC_BY_CODE[holder.code].skills.martial + (holder.code === "torvald" && c.facts.resolved.torvald_3?.choice === "accept" ? 10 : 0)}`;
      } else {
        bonus = bonusText(positionBonus(holder.code, position, holder.stats, c.facts)) ?? "Недостаточно лоялен: бонуса нет";
      }
    }
    return {
      position,
      name: def.name,
      icon: def.icon,
      effect: def.effect,
      holder: holder?.code ?? null,
      bonus,
      candidates: NPCS.filter((n) => n.positions.includes(position)).map((n) => ({ code: n.code, name: n.name, blocked: assignBlocked(c.facts, position, n.code) })),
    };
  });
}

function choiceViews(c: Court, code: string): ChoiceView[] {
  const def = EVENT_BY_CODE[code];
  return def.choices.map((ch) => ({ code: ch.code, label: ch.label, hint: ch.hint ?? null, cost: ch.cost ?? {}, blocked: choiceBlocked(c.facts, code, ch.code) }));
}

function screenOf(c: Court): CourtScreen {
  const events: CourtEventView[] = c.events
    .filter((e) => e.status === "OPEN" && EVENT_BY_CODE[e.event_code])
    .map((e) => {
      const def = EVENT_BY_CODE[e.event_code];
      return {
        id: e.id,
        code: def.code,
        kind: def.kind,
        title: def.title,
        text: def.text.replaceAll("{hero}", c.heroName),
        participants: def.participants.filter((p) => c.facts.npcs[p]?.recruited).map((p) => ({ code: p, name: NPC_BY_CODE[p].name })),
        choices: choiceViews(c, def.code),
      };
    });
  const npcList = Object.values(c.facts.npcs).map((n) => ({ code: n.code, position: n.position, stats: n.stats, recruited: n.recruited }));
  return {
    today: c.today,
    heroName: c.heroName,
    resources: c.facts.resources,
    npcs: NPCS.filter((d) => c.facts.npcs[d.code]).map((d) => card(c, d.code)),
    events,
    positions: positionsView(c),
    dailyBonus: courtEconomyBonus(npcList, c.facts),
    history: c.events
      .filter((e) => e.status === "RESOLVED")
      .reverse()
      .slice(0, 8)
      .map((e) => ({
        code: e.event_code,
        title: e.outcome?.title ?? EVENT_BY_CODE[e.event_code]?.title ?? e.event_code,
        choice: e.outcome?.choice ?? e.selected_choice ?? "",
        text: e.outcome?.text ?? "",
        day: e.resolved_day ?? e.event_day,
      })),
  };
}

export async function getCourtScreen(db: SupabaseClient, userId: string): Promise<CourtScreen> {
  return screenOf(await loadCourt(db, userId, { openEvent: true }));
}

async function detailOf(db: SupabaseClient, c: Court, code: string): Promise<NpcDetail> {
  const def = NPC_BY_CODE[code];
  const row = c.rows.find((r) => r.npc_code === code);
  if (!def || !row) throw new ApiError("NPC_NOT_AVAILABLE");
  const ids = new Map(c.rows.map((r) => [r.id, r.npc_code]));
  const [rel, msg] = await Promise.all([
    db.from("court_relationships").select("npc_a_id, npc_b_id, relationship_type, affinity, rivalry, trust").eq("game_profile_id", c.realm.profileId).or(`npc_a_id.eq.${row.id},npc_b_id.eq.${row.id}`),
    db.from("court_messages").select("id, action, content, source, created_at").eq("npc_id", row.id).order("created_at", { ascending: false }).limit(6),
  ]);
  if (rel.error) throw fromDbError(rel.error);
  if (msg.error) throw fromDbError(msg.error);
  const n = c.facts.npcs[code];
  return {
    card: card(c, code),
    bio: def.bio,
    goals: def.goals,
    traits: def.traits,
    skills: def.skills,
    relations: (rel.data ?? [])
      .map((r) => {
        const other = ids.get(r.npc_a_id === row.id ? r.npc_b_id : r.npc_a_id) ?? "";
        return { code: other, name: NPC_BY_CODE[other]?.name ?? other, type: r.relationship_type, affinity: r.affinity, rivalry: r.rivalry, trust: r.trust };
      })
      .filter((r) => c.facts.npcs[r.code]?.recruited),
    quests: def.major ? questLog(c.facts, code) : [],
    messages: ((msg.data ?? []) as { id: string; action: Interaction; content: string; source: "AI" | "FALLBACK"; created_at: string }[])
      .reverse()
      .map((m) => ({ id: m.id, action: m.action, content: m.content, source: m.source, at: m.created_at })),
    interactions: INTERACTIONS.filter((a) => a !== "walk" || def.romanceable || def.likes.includes("walk")).map((a) => ({
      action: a,
      name: INTERACTION_DEFS[a].name,
      icon: INTERACTION_DEFS[a].icon,
      description: INTERACTION_DEFS[a].description,
      cost: INTERACTION_DEFS[a].cost?.gold ?? 0,
      blocked: interactionBlocked(n, a, c.today, c.facts.resources.gold),
    })),
  };
}

export async function getNpcDetail(db: SupabaseClient, userId: string, code: string): Promise<NpcDetail> {
  if (!NPC_BY_CODE[code]) throw new ApiError("NPC_NOT_AVAILABLE");
  return detailOf(db, await loadCourt(db, userId), code);
}

// ---------------------------------------------------------------------------
// Effects text for the player
// ---------------------------------------------------------------------------
export function describeChanges(f: CourtFacts, ch: CourtChanges): string[] {
  const out: string[] = [];
  for (const n of ch.npcs) {
    const before = f.npcs[n.code];
    if (!before) continue;
    const parts = (Object.keys(STAT_LABELS) as NpcStat[])
      .map((k) => [k, n.stats[k] - before.stats[k]] as const)
      .filter(([, d]) => d !== 0)
      .map(([k, d]) => `${STAT_LABELS[k].toLowerCase()} ${d > 0 ? "+" : ""}${d}`);
    if (parts.length) out.push(`${NPC_BY_CODE[n.code].name}: ${parts.join(", ")}`);
    if (n.status !== before.status) out.push(`${NPC_BY_CODE[n.code].name}: ${STATUS_LABELS[n.status].toLowerCase()}`);
    if (n.position !== before.position) out.push(n.position ? `${NPC_BY_CODE[n.code].name} назначен(а): ${POSITION_DEFS[n.position].name.toLowerCase()}` : `${NPC_BY_CODE[n.code].name} снят(а) с должности`);
  }
  const res = (Object.keys(ch.resources) as (keyof Wallet)[]).filter((k) => ch.resources[k] !== 0).map((k) => `${RESOURCE_WORDS[k]} ${ch.resources[k] > 0 ? "+" : ""}${ch.resources[k]}`);
  if (res.length) out.push(`Казна: ${res.join(", ")}`);
  if (ch.morale) out.push(`Мораль армии ${ch.morale > 0 ? "+" : ""}${ch.morale}`);
  if (ch.territory) out.push(`Территория присоединилась: ${TERRITORIES.find((t) => t.code === ch.territory)?.name ?? ch.territory}`);
  return out;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
const toPayload = (ch: CourtChanges) => ({
  npcs: ch.npcs.map((n) => ({ code: n.code, expected_version: n.expectedVersion, stats: n.stats, status: n.status, position: n.position })),
  relations: ch.relations,
  resources: ch.resources,
  morale: ch.morale,
  territory: ch.territory,
});

const blockedError = (reason: string) =>
  reason.startsWith("Сегодня") ? new ApiError("ALREADY_INTERACTED") : reason.startsWith("Этого персонажа") ? new ApiError("NPC_NOT_AVAILABLE") : new ApiError("CHOICE_UNAVAILABLE", reason);

async function dialogueLine(userId: string, c: Court, code: string, action: Interaction, statsAfter: NpcStats, status: RelationshipStatus, seed: number) {
  const def = NPC_BY_CODE[code];
  const m = mood(statsAfter);
  const recent = c.events.filter((e) => e.status === "RESOLVED").slice(-3).map((e) => e.outcome?.title ?? "").filter(Boolean);
  const ai = await callAi(userId, c.realm.timezone, "COURT_DIALOGUE", {
    messages: courtDialogueMessages({ heroName: c.heroName, npc: def, status, mood: m, action, recentEvents: recent }),
    maxTokens: 220,
    temperature: 0.8,
  }).catch(() => null);
  const text = ai && ai.ok && typeof ai.value === "string" ? cleanDialogue(ai.value) : null;
  if (text) return { content: text, source: "AI" as const };
  const pool = FALLBACK_LINES[code]?.[m] ?? ["..."];
  return { content: pool[seed % pool.length].replaceAll("{hero}", c.heroName), source: "FALLBACK" as const };
}

export interface InteractResult {
  status: "applied" | "duplicate";
  line: { content: string; source: "AI" | "FALLBACK" } | null;
  effects: string[];
  detail: NpcDetail;
}

export async function interact(db: SupabaseClient, userId: string, input: { npcCode: string; action: Interaction; idempotencyKey: string }): Promise<InteractResult> {
  if (!NPC_BY_CODE[input.npcCode]) throw new ApiError("NPC_NOT_AVAILABLE");
  let c = await loadCourt(db, userId);
  let line: InteractResult["line"] = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const n = c.facts.npcs[input.npcCode];
    const prior = await db.from("court_actions").select("result").eq("game_profile_id", c.realm.profileId).eq("idempotency_key", input.idempotencyKey).maybeSingle();
    if (prior.data) return { status: "duplicate", line: null, effects: [], detail: await detailOf(db, c, input.npcCode) };
    const blocked = interactionBlocked(n, input.action, c.today, c.facts.resources.gold);
    if (blocked) throw blockedError(blocked);

    const seed = hashString(`court:${c.realm.profileId}:${input.idempotencyKey}`);
    const deltas = interactionDeltas(c.facts, input.npcCode, input.action, seed);
    const changes = buildChanges(c.facts, deltas, { met: [input.npcCode], resources: input.action === "gift" ? { gold: -(INTERACTION_DEFS.gift.cost?.gold ?? 0) } : {} });
    const after = changes.npcs.find((x) => x.code === input.npcCode)!;
    line ??= await dialogueLine(userId, c, input.npcCode, input.action, after.stats, after.status, seed);

    const r = await rpc<{ status: "applied" | "duplicate" | "stale" }>("court_interact", {
      p_user_id: userId,
      p_key: input.idempotencyKey,
      p_npc_code: input.npcCode,
      p_action: input.action,
      p_day: c.today,
      p_changes: toPayload(changes),
      p_message: line,
    });
    if (r.status === "stale") {
      c = await loadCourt(db, userId);
      continue;
    }
    const effects = r.status === "applied" ? describeChanges(c.facts, changes) : [];
    const fresh = await loadCourt(db, userId);
    return { status: r.status, line: r.status === "applied" ? line : null, effects, detail: await detailOf(db, fresh, input.npcCode) };
  }
  throw new ApiError("RATE_LIMITED", "Двор слишком оживлён. Повторите попытку.");
}

export interface ChooseResult {
  status: "applied" | "duplicate";
  outcome: OutcomeView | null;
  screen: CourtScreen;
}

export async function choose(db: SupabaseClient, userId: string, input: { eventId: string; choice: string; idempotencyKey: string }): Promise<ChooseResult> {
  let c = await loadCourt(db, userId);
  for (let attempt = 0; attempt < 3; attempt++) {
    const prior = await db.from("court_actions").select("result").eq("game_profile_id", c.realm.profileId).eq("idempotency_key", input.idempotencyKey).maybeSingle();
    if (prior.data) return { status: "duplicate", outcome: null, screen: screenOf(c) };
    const ev = c.events.find((e) => e.id === input.eventId);
    if (!ev || ev.status !== "OPEN" || !EVENT_BY_CODE[ev.event_code]) throw new ApiError("EVENT_NOT_OPEN");
    const blocked = choiceBlocked(c.facts, ev.event_code, input.choice);
    if (blocked) throw blockedError(blocked);

    const def = EVENT_BY_CODE[ev.event_code];
    const { outcome, changes } = resolveChoice(c.facts, ev.event_code, input.choice);
    const view: OutcomeView = {
      title: def.title,
      choice: def.choices.find((x) => x.code === input.choice)!.label,
      text: outcome.text,
      effects: describeChanges(c.facts, changes),
    };
    const r = await rpc<{ status: "applied" | "duplicate" | "stale" }>("court_choose", {
      p_user_id: userId,
      p_key: input.idempotencyKey,
      p_event_id: ev.id,
      p_choice: input.choice,
      p_day: c.today,
      p_changes: toPayload(changes),
      p_outcome: view,
    });
    if (r.status === "stale") {
      c = await loadCourt(db, userId);
      continue;
    }
    const fresh = await loadCourt(db, userId);
    return { status: r.status, outcome: r.status === "applied" ? view : null, screen: screenOf(fresh) };
  }
  throw new ApiError("RATE_LIMITED", "Двор слишком оживлён. Повторите попытку.");
}

export async function assign(db: SupabaseClient, userId: string, input: { position: Position; npcCode: string | null; idempotencyKey: string }): Promise<{ status: string; effects: string[]; screen: CourtScreen }> {
  let c = await loadCourt(db, userId);
  for (let attempt = 0; attempt < 3; attempt++) {
    const prior = await db.from("court_actions").select("result").eq("game_profile_id", c.realm.profileId).eq("idempotency_key", input.idempotencyKey).maybeSingle();
    if (prior.data) return { status: "duplicate", effects: [], screen: screenOf(c) };
    const blocked = assignBlocked(c.facts, input.position, input.npcCode);
    if (blocked) throw blockedError(blocked);
    const changes = assignmentChanges(c.facts, input.position, input.npcCode);
    const r = await rpc<{ status: "applied" | "duplicate" | "stale" }>("court_assign", {
      p_user_id: userId,
      p_key: input.idempotencyKey,
      p_position: input.position,
      p_npc_code: input.npcCode,
      p_changes: toPayload(changes),
    });
    if (r.status === "stale") {
      c = await loadCourt(db, userId);
      continue;
    }
    const effects = r.status === "applied" ? describeChanges(c.facts, changes) : [];
    return { status: r.status, effects, screen: screenOf(await loadCourt(db, userId)) };
  }
  throw new ApiError("RATE_LIMITED", "Двор слишком оживлён. Повторите попытку.");
}
