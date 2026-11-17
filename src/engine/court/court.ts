/**
 * Court engine (ТЗ §12.5): participants → current stats → allowed outcomes →
 * consequences → new relationships → game effects. Pure and deterministic; the
 * AI may only write dialogue text, never these numbers.
 */
import { EVENT_BY_CODE, FLAGS, COURT_EVENTS } from "@/data/court/events";
import {
  INTERACTION_DEFS,
  NPC_BY_CODE,
  NPC_STATS,
  NPCS,
  type Interaction,
  type NpcDef,
  type NpcStats,
  type Position,
  type RelationshipStatus,
} from "@/data/court/npcs";
import type { CourtEventDef, CourtFacts, NpcState, Outcome, RelationDelta, Wallet } from "@/data/court/types";
import { isNpcAway } from "@/data/court/availability";
import { daysSince } from "@/data/court/romance";
import { createSeededRandom } from "@/lib/random";

export const clampStat = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

const ROMANTIC: readonly RelationshipStatus[] = ["ROMANCE", "PARTNER"];
const WARM: readonly RelationshipStatus[] = ["FRIENDS", "CLOSE", "ROMANCE", "PARTNER"];

/**
 * Relationship status after a change. Friendship and closeness follow the stats;
 * romance never comes from stats alone: only through a storyline event, where the
 * character decides for herself.
 */
export function statusAfter(def: NpcDef, prev: RelationshipStatus, s: NpcStats, opts: { met?: boolean; explicit?: RelationshipStatus } = {}): RelationshipStatus {
  if (opts.explicit && (def.romanceable || !ROMANTIC.includes(opts.explicit))) return opts.explicit;
  if (ROMANTIC.includes(prev)) return s.affection < 30 ? "BROKEN" : prev;
  if (prev === "BROKEN") return s.affection >= 55 && s.trust >= 50 ? "FRIENDS" : "BROKEN";
  if (s.affection >= 60 && s.trust >= 50) return "CLOSE";
  if (s.affection >= 40 && s.trust >= 30) return "FRIENDS";
  return prev !== "STRANGERS" || opts.met ? "ACQUAINTED" : "STRANGERS";
}

export function mood(s: NpcStats): "warm" | "neutral" | "cold" {
  if (s.affection < 25 || s.loyalty < 30) return "cold";
  if (s.affection >= 55 && s.loyalty >= 40) return "warm";
  return "neutral";
}

// ---------------------------------------------------------------------------
// Changes: what the database applies (absolute stats with optimistic versions)
// ---------------------------------------------------------------------------
export interface NpcChange {
  code: string;
  expectedVersion: number;
  stats: NpcStats;
  status: RelationshipStatus;
  position: Position | null;
  absentUntilDay?: string | null;
}

export interface CourtChanges {
  npcs: NpcChange[];
  relations: RelationDelta[];
  resources: Wallet;
  morale: number;
  territory: string | null;
}

type Deltas = Record<string, Partial<NpcStats>>;

export function buildChanges(
  f: CourtFacts,
  deltas: Deltas,
  extra: { status?: Record<string, RelationshipStatus>; met?: string[]; positions?: Record<string, Position | null>; resources?: Partial<Wallet>; morale?: number; relations?: RelationDelta[]; territory?: string | null; absentUntil?: Record<string, string | null> } = {},
): CourtChanges {
  const touched = new Set([...Object.keys(deltas), ...Object.keys(extra.status ?? {}), ...(extra.met ?? []), ...Object.keys(extra.positions ?? {}), ...Object.keys(extra.absentUntil ?? {})]);
  const npcs: NpcChange[] = [];
  for (const code of touched) {
    const n = f.npcs[code];
    const def = NPC_BY_CODE[code];
    if (!n || !def) continue;
    const d = deltas[code] ?? {};
    const stats = Object.fromEntries(NPC_STATS.map((k) => [k, clampStat(n.stats[k] + (d[k] ?? 0))])) as NpcStats;
    npcs.push({
      code,
      expectedVersion: n.version,
      ...(extra.absentUntil && code in extra.absentUntil ? { absentUntilDay: extra.absentUntil[code] } : {}),
      stats,
      status: statusAfter(def, n.status, stats, { met: extra.met?.includes(code), explicit: extra.status?.[code] }),
      position: extra.positions && code in extra.positions ? extra.positions[code] : n.position,
    });
  }
  return {
    npcs,
    relations: extra.relations ?? [],
    resources: { gold: extra.resources?.gold ?? 0, food: extra.resources?.food ?? 0, knowledge: extra.resources?.knowledge ?? 0, influence: extra.resources?.influence ?? 0 },
    morale: extra.morale ?? 0,
    territory: extra.territory ?? null,
  };
}

// ---------------------------------------------------------------------------
// Daily interactions
// ---------------------------------------------------------------------------
export const GIFT_AFFECTION_OVER_TRUST = 15;

export function interactionBlocked(n: NpcState | undefined, action: Interaction, day: string, gold: number): string | null {
  if (!n || !n.recruited) return "Этого персонажа пока нет при дворе";
  if (isNpcAway(n, day)) return `Персонаж в поездке. Вернётся ${n.absentUntilDay}.`;
  if (n.lastInteractionDay === day) return "Сегодня вы уже уделили время этому персонажу";
  if (action === "gift" && gold < (INTERACTION_DEFS.gift.cost?.gold ?? 0)) return "Не хватает золота";
  if (action === "walk" && !WARM.includes(n.status)) return "Нужна дружба";
  if (n.status === "BROKEN" && (action === "walk" || action === "gift")) return "После разрыва это неуместно";
  return null;
}

const BASE: Record<Interaction, Partial<NpcStats>> = {
  talk: { affection: 3, trust: 2 },
  counsel: { trust: 3, loyalty: 2 },
  gift: { affection: 4, loyalty: 1 },
  walk: { affection: 5, trust: 2 },
};

/** Stat changes of one interaction, for the character and for jealous rivals. */
export function interactionDeltas(f: CourtFacts, code: string, action: Interaction, seed: number): Deltas {
  const def = NPC_BY_CODE[code];
  const n = f.npcs[code];
  const rng = createSeededRandom(seed);
  const d: Partial<NpcStats> = { ...BASE[action] };
  const scale = (k: number) => {
    for (const key of Object.keys(d) as (keyof NpcStats)[]) if ((d[key] ?? 0) > 0) d[key] = Math.max(0, Math.round((d[key] ?? 0) * k));
  };
  if (def.likes.includes(action)) scale(1.5);
  else if (def.dislikes.includes(action)) scale(0.34);
  if (n.status === "BROKEN") scale(0.5);
  if (action === "counsel" && def.start.ambition >= 60) d.influence = (d.influence ?? 0) + 1;
  if (rng() < 0.35) {
    const keys = (Object.keys(d) as (keyof NpcStats)[]).filter((k) => (d[k] ?? 0) > 0);
    if (keys.length) {
      const k = keys[Math.floor(rng() * keys.length)];
      d[k] = (d[k] ?? 0) + 1;
    }
  }
  if (action === "talk" || action === "walk") d.jealousy = (d.jealousy ?? 0) - 2;
  // Gifts never buy affection beyond what trust allows.
  if (action === "gift" && d.affection) {
    const cap = Math.max(n.stats.affection, n.stats.trust + GIFT_AFFECTION_OVER_TRUST);
    d.affection = Math.max(0, Math.min(d.affection, cap - n.stats.affection));
  }
  const out: Deltas = { [code]: d };
  if (def.romanceable && (action === "walk" || action === "gift")) {
    for (const other of NPCS) {
      const o = f.npcs[other.code];
      if (other.code === code || !other.romanceable || !o?.recruited) continue;
      if (!["CLOSE", "ROMANCE", "PARTNER"].includes(o.status)) continue;
      const j = ROMANTIC.includes(o.status) ? 6 : 4;
      out[other.code] = { jealousy: j, ...(o.stats.jealousy + j >= 70 ? { loyalty: -2 } : {}) };
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Positions
// ---------------------------------------------------------------------------
export const DISLOYAL_BELOW = 30;

export function positionBonus(code: string, position: Position, stats: NpcStats, f: Pick<CourtFacts, "resolved">): Partial<Wallet> {
  const def = NPC_BY_CODE[code];
  if (!def || stats.loyalty < DISLOYAL_BELOW) return {};
  switch (position) {
    case "treasurer":
      return { gold: Math.floor(def.skills.stewardship / 5) * (code === "bram" && FLAGS.bramReform(f) ? 2 : 1) };
    case "chancellor":
      return { knowledge: Math.floor(def.skills.learning / 20) };
    case "envoy":
      return { influence: Math.floor(def.skills.diplomacy / 25) };
    default:
      return {};
  }
}

export function courtEconomyBonus(npcs: Pick<NpcState, "code" | "position" | "stats" | "recruited">[], f: Pick<CourtFacts, "resolved">): Wallet {
  const total: Wallet = { gold: 0, food: 0, knowledge: 0, influence: 0 };
  for (const n of npcs) {
    if (!n.position || !n.recruited) continue;
    const b = positionBonus(n.code, n.position, n.stats, f);
    for (const k of Object.keys(b) as (keyof Wallet)[]) total[k] += b[k] ?? 0;
  }
  return total;
}

/** Military skill the appointed commander brings to battle (null when disloyal). */
export function commanderSkill(code: string, stats: NpcStats, f: Pick<CourtFacts, "resolved">): number | null {
  const def = NPC_BY_CODE[code];
  if (!def || stats.loyalty < DISLOYAL_BELOW) return null;
  return def.skills.martial + (code === "torvald" && FLAGS.torvaldOath(f) ? 10 : 0);
}

export function assignBlocked(f: CourtFacts, position: Position, code: string | null): string | null {
  if (code === null) return null;
  const def = NPC_BY_CODE[code];
  const n = f.npcs[code];
  if (!def || !n?.recruited) return "Этого персонажа пока нет при дворе";
  if (isNpcAway(n, f.day)) return "Назначение можно обсудить после возвращения";
  if (!def.positions.includes(position)) return "Эта должность не подходит персонажу";
  if (n.position === position) return "Уже на этой должности";
  return null;
}

export function assignmentChanges(f: CourtFacts, position: Position, code: string | null): CourtChanges {
  const deltas: Deltas = {};
  const positions: Record<string, Position | null> = {};
  const previous = Object.values(f.npcs).find((n) => n.position === position);
  if (previous && previous.code !== code) {
    deltas[previous.code] = { loyalty: -8, affection: -3, influence: -5 };
    positions[previous.code] = null;
  }
  if (code) {
    deltas[code] = { loyalty: 5, influence: 5, jealousy: -5 };
    positions[code] = position;
    for (const def of NPCS) {
      const o = f.npcs[def.code];
      if (def.code === code || def.code === previous?.code || !o?.recruited || !def.positions.includes(position) || o.stats.ambition < 60) continue;
      deltas[def.code] = { jealousy: 10, loyalty: -3 };
    }
  }
  return buildChanges(f, deltas, { positions });
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
export const MAX_OPEN_EVENTS = 2;

export function eligibleEvents(f: CourtFacts): CourtEventDef[] {
  return COURT_EVENTS.filter((e) => {
    const previous = f.resolved[e.code];
    const breakup = e.npc ? f.npcs[e.npc]?.brokenSinceDay : null;
    const reconciled = e.npc ? f.resolved[`${e.npc}_reconcile`] : null;
    const newBreak = e.code.endsWith("_reconcile") && !!breakup && !!previous && breakup >= previous.day;
    const newCommitment = e.code.endsWith("_commitment") && reconciled?.choice === "reconcile"
      && !!previous && reconciled.day > previous.day;
    const cooledDown = !!previous && e.cooldownDays !== undefined && daysSince(f.day, previous.day) >= e.cooldownDays;
    return (!previous || newBreak || newCommitment || cooledDown) && !f.open.includes(e.code)
      && !e.participants.some((code) => isNpcAway(f.npcs[code], f.day)) && e.requires(f);
  });
}

/** At most one new event per day; storylines first, then intrigues and politics. */
export function pickDailyEvent(f: CourtFacts, seed: number, openedToday: boolean): CourtEventDef | null {
  if (openedToday || f.open.length >= MAX_OPEN_EVENTS) return null;
  const eligible = eligibleEvents(f);
  if (eligible.length === 0) return null;
  const quests = eligible.filter((e) => e.kind === "quest");
  const romances = eligible.filter((e) => e.kind === "romance");
  const pool = quests.length > 0 ? quests : romances.length > 0 ? romances : eligible;
  return pool[Math.floor(createSeededRandom(seed)() * pool.length)];
}

export function choiceBlocked(f: CourtFacts, eventCode: string, choiceCode: string): string | null {
  const e = EVENT_BY_CODE[eventCode];
  const c = e?.choices.find((x) => x.code === choiceCode);
  if (!e || !c) return "Такого варианта нет";
  if (c.allowWhenUnavailable) return null;
  if (e.participants.some((code) => isNpcAway(f.npcs[code], f.day))) return "Разговор продолжится после возвращения участников";
  return c.unavailable?.(f) ?? null;
}

export function resolveChoice(f: CourtFacts, eventCode: string, choiceCode: string): { outcome: Outcome; changes: CourtChanges } {
  const e = EVENT_BY_CODE[eventCode];
  const c = e.choices.find((x) => x.code === choiceCode)!;
  const outcome = c.resolve(f);
  const resources: Partial<Wallet> = { ...outcome.resources };
  for (const [k, v] of Object.entries(c.cost ?? {}) as [keyof Wallet, number][]) resources[k] = (resources[k] ?? 0) - v;
  const positions: Record<string, Position | null> = {};
  for (const code of outcome.dismiss ?? []) if (f.npcs[code]?.position) positions[code] = null;
  const territory = outcome.territory && ["NEUTRAL", "FACTION"].includes(f.territories[outcome.territory] ?? "") ? outcome.territory : null;
  const changes = buildChanges(f, outcome.npcs ?? {}, {
    status: outcome.status,
    positions,
    resources,
    morale: outcome.morale,
    relations: outcome.relations,
    territory,
    absentUntil: outcome.absentUntil,
  });
  return { outcome: { ...outcome, text: outcome.text.replaceAll("{hero}", f.heroName) }, changes };
}

// ---------------------------------------------------------------------------
// Recruitment and the quest log
// ---------------------------------------------------------------------------
export function newcomers(f: CourtFacts): string[] {
  const owned = Object.values(f.territories).filter((o) => o === "HERO").length;
  return NPCS.filter((def) => {
    const n = f.npcs[def.code];
    if (!n || n.recruited || !def.joins) return false;
    const j = def.joins;
    if (j.kind === "territories") return owned >= j.count;
    if (j.kind === "building") return f.buildings[j.type] >= 1;
    return !!f.resolved[j.code];
  }).map((d) => d.code);
}

export interface QuestStepView {
  code: string;
  step: number;
  title: string;
  state: "done" | "open" | "ready" | "locked";
  choice: string | null;
  hint: string | null;
}

export function questLog(f: CourtFacts, npcCode: string): QuestStepView[] {
  return COURT_EVENTS.filter((e) => e.kind === "quest" && !e.cooldownDays && e.npc === npcCode)
    .sort((a, b) => (a.step ?? 0) - (b.step ?? 0))
    .map((e) => {
      const r = f.resolved[e.code];
      const state: QuestStepView["state"] = r ? "done" : f.open.includes(e.code) ? "open" : e.requires(f) ? "ready" : "locked";
      return {
        code: e.code,
        step: e.step ?? 0,
        title: e.title,
        state,
        choice: r ? (e.choices.find((c) => c.code === r.choice)?.label ?? r.choice) : null,
        hint: state === "locked" ? (typeof e.hint === "function" ? e.hint(f) : e.hint ?? null) : null,
      };
    });
}
