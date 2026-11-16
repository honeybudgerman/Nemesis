/**
 * Story engine (ТЗ §13). Pure functions: given the chapter, its saved progress
 * and facts taken from real game state, decide what the player sees next and
 * what an action changes. The database re-checks every condition.
 */
import { CHAPTERS, CHAPTER_BY_CODE, SPEAKERS, type ChapterDef, type StoryChoiceDef, type StoryWallet } from "@/data/story/chapters";
import type { ProgressFacts } from "@/data/story/progress";
import { ACHIEVEMENTS, ITEM_BY_CODE } from "@/data/story/rewards";
import { armyPower, type Army, type BattleInput } from "@/engine/realm/battle";
import { UNIT_TYPES, UNITS, TIER_MODIFIER, unitPower } from "@/data/realm/units";

export interface ChapterProgress {
  chapter: string;
  status: "ACTIVE" | "COMPLETED";
  introSeen: boolean;
  decision: string | null;
  bossDefeated: boolean;
  bossLastAttemptDay: string | null;
}

export type ChapterStage = "intro" | "objectives" | "boss" | "ready" | "completed";

export interface ObjectiveState {
  code: string;
  label: string;
  current: number;
  target: number;
  done: boolean;
}

export function objectiveStates(ch: ChapterDef, facts: ProgressFacts): ObjectiveState[] {
  return ch.objectives.map((o) => {
    const current = Math.floor(facts[o.metric] ?? 0);
    return { code: o.code, label: o.label, current: Math.min(current, o.target), target: o.target, done: current >= o.target };
  });
}

export function objectivesDone(ch: ChapterDef, facts: ProgressFacts): boolean {
  return objectiveStates(ch, facts).every((o) => o.done);
}

export function chapterStage(ch: ChapterDef, p: ChapterProgress, facts: ProgressFacts): ChapterStage {
  if (p.status === "COMPLETED") return "completed";
  if (!p.introSeen) return "intro";
  if (!objectivesDone(ch, facts) || !p.decision) return "objectives";
  if (ch.boss && !p.bossDefeated) return "boss";
  return "ready";
}

/** The chapter that should be active: the first one not completed. */
export function currentChapter(progress: ChapterProgress[]): ChapterDef | null {
  const done = new Set(progress.filter((p) => p.status === "COMPLETED").map((p) => p.chapter));
  return CHAPTERS.find((c) => !done.has(c.code)) ?? null;
}

export function nextChapterCode(code: string): string | null {
  const i = CHAPTERS.findIndex((c) => c.code === code);
  return i >= 0 && i + 1 < CHAPTERS.length ? CHAPTERS[i + 1].code : null;
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------
type Wallet4 = Record<"gold" | "food" | "knowledge" | "influence", number>;

export function choiceBlocked(c: StoryChoiceDef, wallet: Wallet4): string | null {
  for (const [k, v] of Object.entries(c.cost ?? {}) as [keyof Wallet4, number][]) {
    if ((wallet[k] ?? 0) < v) return "Не хватает ресурсов.";
  }
  return null;
}

/** Signed resource deltas and morale change of a decision. */
export function choiceChanges(c: StoryChoiceDef): { resources: Wallet4; morale: number } {
  const r: Wallet4 = { gold: 0, food: 0, knowledge: 0, influence: 0 };
  for (const [k, v] of Object.entries(c.gain ?? {}) as [keyof Wallet4, number][]) r[k] += v;
  for (const [k, v] of Object.entries(c.cost ?? {}) as [keyof Wallet4, number][]) r[k] -= v;
  return { resources: r, morale: c.morale ?? 0 };
}

export function decisionBlocked(ch: ChapterDef, p: ChapterProgress, choice: string, wallet: Wallet4): string | null {
  if (p.status !== "ACTIVE" || !p.introSeen) return "Глава ещё не началась.";
  if (p.decision) return "Решение уже принято.";
  const c = ch.decision.choices.find((x) => x.code === choice);
  if (!c) return "Нет такого варианта.";
  return choiceBlocked(c, wallet);
}

// ---------------------------------------------------------------------------
// Bosses
// ---------------------------------------------------------------------------
export function bossBlocked(
  ch: ChapterDef,
  p: ChapterProgress,
  facts: ProgressFacts,
  today: string,
  state: { commandPoints: number; army: Army },
): string | null {
  if (!ch.boss) return "В этой главе нет босса.";
  if (p.status !== "ACTIVE" || !p.introSeen) return "Глава ещё не началась.";
  if (p.bossDefeated) return "Босс уже повержен.";
  if (!objectivesDone(ch, facts)) return "Сначала выполните цели главы.";
  if (!p.decision) return "Сначала примите решение главы.";
  if (p.bossLastAttemptDay === today) return "Сегодня армия уже штурмовала. Новая попытка — завтра.";
  if (state.commandPoints < 1) return "Нет очков командования.";
  if (armyPower(state.army) <= 0) return "Нет армии.";
  return null;
}

export function bossTarget(ch: ChapterDef): BattleInput["target"] {
  if (!ch.boss) throw new Error(`chapter ${ch.code} has no boss`);
  return { ...ch.boss.target };
}

export function canComplete(ch: ChapterDef, p: ChapterProgress, facts: ProgressFacts): boolean {
  return chapterStage(ch, p, facts) === "ready";
}

// ---------------------------------------------------------------------------
// Items, achievements
// ---------------------------------------------------------------------------
export function itemEffects(items: readonly string[]): { economy: Wallet4; battlePower: number } {
  const economy: Wallet4 = { gold: 0, food: 0, knowledge: 0, influence: 0 };
  let battlePower = 0;
  for (const code of new Set(items)) {
    const it = ITEM_BY_CODE[code];
    if (!it) continue;
    for (const [k, v] of Object.entries(it.economy ?? {}) as [keyof Wallet4, number][]) economy[k] += v;
    battlePower += it.battlePower ?? 0;
  }
  return { economy, battlePower: Math.round(battlePower * 100) / 100 };
}

export function earnedAchievements(facts: ProgressFacts, unlocked: Iterable<string>): string[] {
  const have = new Set(unlocked);
  return ACHIEVEMENTS.filter((a) => !have.has(a.code) && (facts[a.metric] ?? 0) >= a.target).map((a) => a.code);
}

/** Unit power weights for the database check of the armyPower metric. */
export function unitPowerWeights(): Record<string, number> {
  return Object.fromEntries(UNIT_TYPES.map((t) => [t, unitPower(t) * TIER_MODIFIER[UNITS[t].tier]]));
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------
export function fillHero(text: string, hero: string): string {
  return text.replaceAll("{hero}", hero);
}

export function speakerName(speaker: keyof typeof SPEAKERS, hero: string): string {
  return fillHero(SPEAKERS[speaker].name, hero);
}

export function walletText(w: StoryWallet | undefined, sign: "+" | "−"): string[] {
  const names = { gold: "золота", food: "еды", knowledge: "знаний", influence: "влияния" } as const;
  return Object.entries(w ?? {})
    .filter(([, v]) => v)
    .map(([k, v]) => `${sign}${v} ${names[k as keyof typeof names]}`);
}

export { CHAPTERS, CHAPTER_BY_CODE };
