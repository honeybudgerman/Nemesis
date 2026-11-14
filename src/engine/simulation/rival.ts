/**
 * Independent rival simulation (ТЗ §7). Pure and deterministic: the same state,
 * day and seed always produce the same result, so missed days can be replayed
 * on the server and re-checked in tests.
 *
 * Kael's progress depends only on his own parameters and the seeded RNG — the
 * hero's activity is not an input, so it can never be used to "rubber-band" him.
 * He earns XP by the same rules as the hero (time × difficulty × grade).
 */
import { KAEL_SKILL_AFFINITY } from "@/data/rival/kael";
import {
  ACTION_TITLES,
  OUTCOME_SUFFIX,
  REST_LINES,
  RISK_LOSS_LINES,
  type RivalOutcome,
} from "@/data/rival/narratives";
import { SKILL_CODES, type SkillCode } from "@/data/skills";
import { baseXpFor } from "@/engine/progression/rewards";
import { levelForXp, xpReward, type Grade } from "@/engine/progression/xp";
import { addDays, formatLocalDate, isoWeekday, parseLocalDate } from "@/lib/time";
import { createSeededRandom, hashString, pickOne, type Rng } from "@/lib/random";

export interface RivalParams {
  /** 0..1 — how reliably Kael sticks to his plan. */
  discipline: number;
  /** Multiplier on earned XP (talent). */
  learning: number;
  /** 0..1 — appetite for risky decisions (source of costly mistakes). */
  risk: number;
  /** Planned minutes per day. */
  dailyMinutes: number;
}

export interface RivalState {
  version: number;
  rngSeed: number;
  params: RivalParams;
  /** Fatigue in permille, 0..1000. Integer to keep storage exact. */
  fatigue: number;
  totalXp: number;
  skillXp: Record<SkillCode, number>;
  gold: number;
}

export interface RivalAction {
  actionIndex: number;
  actionType: "STUDY" | "REST";
  category: SkillCode | null;
  plannedMinutes: number;
  difficulty: number;
  outcome: RivalOutcome;
  grade: Grade | null;
  xpAwarded: number;
  goldDelta: number;
  narrative: string;
}

export interface RivalDayResult {
  day: string;
  availableMinutes: number;
  actions: RivalAction[];
  xpGained: number;
  goldDelta: number;
  state: RivalState;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function daySeed(rngSeed: number, day: string, version: number): number {
  return hashString(`kael:v${version}:${rngSeed}:${day}`);
}

function weightedPick<T>(items: readonly T[], weights: readonly number[], rng: Rng): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r < 0) return items[i];
  }
  return items[items.length - 1];
}

/** Minutes Kael actually has today: varies around his plan, shrinks with fatigue. */
export function calculateAvailableMinutes(state: RivalState, rng: Rng): number {
  const f = state.fatigue / 1000;
  const swing = 0.7 + 0.6 * rng();
  return Math.max(0, Math.round(state.params.dailyMinutes * swing * (1 - 0.4 * f)));
}

/** Probability that Kael rests instead of working (ТЗ: rest is allowed for both sides). */
function restChance(state: RivalState, day: string): number {
  const sunday = isoWeekday(parseLocalDate(day)) === 7 ? 0.1 : 0;
  return clamp(0.05 + 0.3 * (state.fatigue / 1000) + sunday - 0.05 * state.params.discipline, 0.02, 0.6);
}

/** Lower-level skills get more attention, shaped by Kael's personal affinities. */
function categoryWeights(state: RivalState): number[] {
  return SKILL_CODES.map((code) => KAEL_SKILL_AFFINITY[code] / (1 + 0.25 * levelForXp(state.skillXp[code])));
}

function chooseDifficulty(skillLevel: number, rng: Rng): number {
  const base = skillLevel < 3 ? 2 : skillLevel < 8 ? 3 : 4;
  return clamp(base + (rng() < 0.25 ? 1 : 0) - (rng() < 0.15 ? 1 : 0), 1, 5);
}

/** Chance of a clean success: discipline and skill help; difficulty and fatigue hurt. */
export function successProbability(state: RivalState, skillLevel: number, difficulty: number, rng: Rng): number {
  const f = state.fatigue / 1000;
  const noise = (rng() - 0.5) * 0.2;
  return clamp(0.3 + 0.45 * state.params.discipline + 0.03 * skillLevel - 0.07 * difficulty - 0.3 * f + noise, 0.05, 0.95);
}

function narrativeFor(category: SkillCode, outcome: Exclude<RivalOutcome, "REST">, xp: number, rng: Rng): string {
  const title = pickOne(ACTION_TITLES[category], rng);
  const suffix = pickOne(OUTCOME_SUFFIX[outcome], rng);
  return `Каэль ${title}${suffix}. +${xp} XP.`;
}

export function simulateRivalDay(state: RivalState, day: string): RivalDayResult {
  const rng = createSeededRandom(daySeed(state.rngSeed, day, state.version));
  const skillXp = { ...state.skillXp };
  let gold = state.gold;
  const actions: RivalAction[] = [];

  // 1. Rest day?
  if (rng() < restChance(state, day)) {
    actions.push({
      actionIndex: 0,
      actionType: "REST",
      category: null,
      plannedMinutes: 0,
      difficulty: 0,
      outcome: "REST",
      grade: null,
      xpAwarded: 0,
      goldDelta: 0,
      narrative: pickOne(REST_LINES, rng),
    });
    return {
      day,
      availableMinutes: 0,
      actions,
      xpGained: 0,
      goldDelta: 0,
      state: { ...state, fatigue: Math.round(state.fatigue * 0.3) },
    };
  }

  // 2. Available time and plan.
  const available = calculateAvailableMinutes(state, rng);
  let left = available;
  let worked = 0;
  let xpGained = 0;
  let goldDelta = 0;

  while (left >= 10 && actions.length < 4) {
    const category = weightedPick(SKILL_CODES, categoryWeights({ ...state, skillXp }), rng);
    const minutes = Math.min(left, pickOne([15, 20, 25, 30], rng));
    const skillLevel = levelForXp(skillXp[category]);
    const difficulty = chooseDifficulty(skillLevel, rng);
    const p = successProbability(state, skillLevel, difficulty, rng);
    const roll = rng();

    let outcome: Exclude<RivalOutcome, "REST">;
    let grade: Grade;
    if (roll < p) {
      outcome = "SUCCESS";
      grade = rng() < 0.15 ? "S" : "A";
    } else if (roll < p + 0.2) {
      outcome = "PARTIAL";
      grade = rng() < 0.5 ? "B" : "C";
    } else {
      outcome = "FAIL";
      grade = rng() < 0.5 ? "D" : "F";
    }

    // Same reward rules as the hero, scaled by Kael's learning factor.
    const xp = Math.floor((xpReward(baseXpFor(minutes, difficulty), grade) * Math.round(state.params.learning * 100) + 50) / 100);
    let actionGold = Math.floor(xp / 2);
    let narrative = narrativeFor(category, outcome, xp, rng);

    // Costly mistakes: a failed trading decision under high risk tolerance loses gold.
    if (outcome === "FAIL" && (category === "trading_analysis" || category === "risk_management") && rng() < state.params.risk * 0.6) {
      const loss = Math.min(gold + actionGold, 5 + Math.floor(rng() * 21));
      actionGold -= loss;
      narrative += " " + pickOne(RISK_LOSS_LINES, rng).replace("{gold}", String(loss));
    }

    skillXp[category] += xp;
    gold += actionGold;
    xpGained += xp;
    goldDelta += actionGold;
    worked += minutes;
    left -= minutes;

    actions.push({
      actionIndex: actions.length,
      actionType: "STUDY",
      category,
      plannedMinutes: minutes,
      difficulty,
      outcome,
      grade,
      xpAwarded: xp,
      goldDelta: actionGold,
      narrative,
    });
  }

  // 3. Fatigue: decays daily, grows with work relative to his plan.
  const load = state.params.dailyMinutes > 0 ? worked / state.params.dailyMinutes : 0;
  const fatigue = clamp(Math.round(state.fatigue * 0.6 + 250 * load), 0, 1000);

  return {
    day,
    availableMinutes: available,
    actions,
    xpGained,
    goldDelta,
    state: { ...state, fatigue, totalXp: state.totalXp + xpGained, skillXp, gold },
  };
}

/** Days strictly after `lastDay` and strictly before `today` (only finished days are simulated). */
export function pendingDays(lastDay: string, today: string): string[] {
  const out: string[] = [];
  let d = addDays(parseLocalDate(lastDay), 1);
  const end = today;
  while (formatLocalDate(d) < end) {
    out.push(formatLocalDate(d));
    d = addDays(d, 1);
    if (out.length > 3660) break; // ten years: hard safety stop
  }
  return out;
}

export function countPendingDays(lastDay: string, today: string): number {
  const a = parseLocalDate(lastDay);
  const b = parseLocalDate(today);
  const diff = Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86400000) - 1;
  return Math.max(0, diff);
}

/** Simulate up to `maxDays` pending days sequentially. */
export function simulateBatch(
  state: RivalState,
  lastDay: string,
  today: string,
  maxDays: number,
): { days: RivalDayResult[]; state: RivalState; lastDay: string; remaining: number } {
  const all = pendingDays(lastDay, today);
  const batch = all.slice(0, maxDays);
  const days: RivalDayResult[] = [];
  let s = state;
  for (const day of batch) {
    const r = simulateRivalDay(s, day);
    days.push(r);
    s = r.state;
  }
  return {
    days,
    state: s,
    lastDay: batch.length ? batch[batch.length - 1] : lastDay,
    remaining: all.length - batch.length,
  };
}
