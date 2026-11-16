import { describe, expect, it } from "vitest";
import { CHAPTERS, CHAPTER_BY_CODE, SPEAKERS } from "@/data/story/chapters";
import { EMPTY_FACTS, PROGRESS_METRICS, type ProgressFacts } from "@/data/story/progress";
import { ACHIEVEMENTS, ITEM_BY_CODE, ITEMS, TITLE_BY_CODE, TITLES } from "@/data/story/rewards";
import { estimateRisk, resolveBattle } from "@/engine/realm/battle";
import {
  bossBlocked,
  chapterStage,
  choiceChanges,
  currentChapter,
  decisionBlocked,
  earnedAchievements,
  fillHero,
  itemEffects,
  nextChapterCode,
  objectiveStates,
  type ChapterProgress,
} from "@/engine/story/story";

const facts = (over: Partial<ProgressFacts> = {}): ProgressFacts => ({ ...EMPTY_FACTS, heroLevel: 1, territories: 1, ...over });
const fresh = (chapter = "ch1", over: Partial<ChapterProgress> = {}): ChapterProgress => ({
  chapter, status: "ACTIVE", introSeen: false, decision: null, bossDefeated: false, bossLastAttemptDay: null, ...over,
});
const ch1 = CHAPTER_BY_CODE.ch1;
const ch3 = CHAPTER_BY_CODE.ch3;
const wallet = { gold: 500, food: 200, knowledge: 0, influence: 10 };
const ch1Done = facts({ questsCompleted: 3, buildings: 1, battlesWon: 1 });

describe("story data", () => {
  it("has three chapters with intro, objectives, a decision and an outro; rewards exist", () => {
    expect(CHAPTERS.map((c) => c.number)).toEqual([1, 2, 3]);
    expect(CHAPTERS.filter((c) => c.boss).map((c) => c.code)).toEqual(["ch1", "ch3"]);
    for (const c of CHAPTERS) {
      expect(c.intro.lines.length).toBeGreaterThan(2);
      expect(c.outro.lines.length).toBeGreaterThan(2);
      expect(c.objectives.length).toBeGreaterThan(0);
      expect(c.decision.choices.length).toBe(3);
      for (const l of [...c.intro.lines, ...c.outro.lines]) expect(SPEAKERS[l.speaker]).toBeDefined();
      for (const o of c.objectives) expect(PROGRESS_METRICS).toContain(o.metric);
      for (const i of c.rewards.items) expect(ITEM_BY_CODE[i]).toBeDefined();
      for (const t of c.rewards.titles) expect(TITLE_BY_CODE[t]).toBeDefined();
      if (c.boss?.item) expect(ITEM_BY_CODE[c.boss.item]).toBeDefined();
    }
    for (const a of ACHIEVEMENTS) {
      expect(PROGRESS_METRICS).toContain(a.metric);
      if (a.title) expect(TITLE_BY_CODE[a.title]).toBeDefined();
    }
    expect(new Set(TITLES.map((t) => t.code)).size).toBe(TITLES.length);
    expect(ITEMS.length).toBeGreaterThanOrEqual(4);
  });

  it("achievements never reward risky money moves or harmful actions", () => {
    const text = ACHIEVEMENTS.map((a) => `${a.name} ${a.description}`).join(" ").toLowerCase();
    for (const bad of ["кредит", "ставк", "казино", "займ", "без сна", "голод", "всё на"]) expect(text).not.toContain(bad);
  });
});

describe("chapter flow", () => {
  it("intro → objectives (and the decision) → boss → ready → completed", () => {
    expect(chapterStage(ch1, fresh(), ch1Done)).toBe("intro");
    expect(chapterStage(ch1, fresh("ch1", { introSeen: true }), facts())).toBe("objectives");
    expect(chapterStage(ch1, fresh("ch1", { introSeen: true }), ch1Done)).toBe("objectives"); // no decision yet
    expect(chapterStage(ch1, fresh("ch1", { introSeen: true, decision: "grain" }), ch1Done)).toBe("boss");
    expect(chapterStage(ch1, fresh("ch1", { introSeen: true, decision: "grain", bossDefeated: true }), ch1Done)).toBe("ready");
    expect(chapterStage(ch1, fresh("ch1", { status: "COMPLETED" }), facts())).toBe("completed");
    const ch2 = CHAPTER_BY_CODE.ch2;
    const ch2Done = facts({ courtFriends: 1, courtEventsResolved: 2, territories: 3, positionsFilled: 1 });
    expect(chapterStage(ch2, fresh("ch2", { introSeen: true, decision: "keep" }), ch2Done)).toBe("ready");
  });

  it("objectives read real progress and cap at the target", () => {
    const o = objectiveStates(ch1, facts({ questsCompleted: 7, buildings: 0 }));
    expect(o.map((x) => [x.code, x.current, x.done])).toEqual([["quests", 3, true], ["build", 0, false], ["battle", 0, false]]);
  });

  it("the current chapter is the first one not completed", () => {
    expect(currentChapter([])?.code).toBe("ch1");
    expect(currentChapter([fresh("ch1", { status: "COMPLETED" }), fresh("ch2")])?.code).toBe("ch2");
    expect(currentChapter(CHAPTERS.map((c) => fresh(c.code, { status: "COMPLETED" })))).toBeNull();
    expect(nextChapterCode("ch1")).toBe("ch2");
    expect(nextChapterCode("ch3")).toBeNull();
  });

  it("decisions are taken once and must be affordable", () => {
    expect(decisionBlocked(ch1, fresh(), "grain", wallet)).toMatch(/не началась/);
    expect(decisionBlocked(ch1, fresh("ch1", { introSeen: true }), "grain", wallet)).toBeNull();
    expect(decisionBlocked(ch1, fresh("ch1", { introSeen: true }), "grain", { ...wallet, food: 10 })).toMatch(/ресурсов/);
    expect(decisionBlocked(ch1, fresh("ch1", { introSeen: true, decision: "later" }), "grain", wallet)).toMatch(/уже принято/);
    expect(decisionBlocked(ch1, fresh("ch1", { introSeen: true }), "nope", wallet)).toMatch(/варианта/);
    expect(choiceChanges(ch1.decision.choices[1])).toEqual({ resources: { gold: -60, food: 0, knowledge: 0, influence: 3 }, morale: 0 });
  });

  it("the boss needs objectives, the decision, a command point and one try per day", () => {
    const ready = fresh("ch1", { introSeen: true, decision: "later" });
    const st = { commandPoints: 2, army: { infantry: 10 } };
    expect(bossBlocked(ch1, ready, facts(), "2026-11-20", st)).toMatch(/цели/);
    expect(bossBlocked(ch1, fresh("ch1", { introSeen: true }), ch1Done, "2026-11-20", st)).toMatch(/решение/);
    expect(bossBlocked(ch1, ready, ch1Done, "2026-11-20", st)).toBeNull();
    expect(bossBlocked(ch1, { ...ready, bossLastAttemptDay: "2026-11-20" }, ch1Done, "2026-11-20", st)).toMatch(/завтра/);
    expect(bossBlocked(ch1, ready, ch1Done, "2026-11-20", { ...st, commandPoints: 0 })).toMatch(/командования/);
    expect(bossBlocked(CHAPTER_BY_CODE.ch2, ready, ch1Done, "2026-11-20", st)).toMatch(/нет босса/);
  });

  it("bosses are beatable with the army the chapter asks for, not before", () => {
    // Chapter 1: ten infantry (a barracks and one recruitment) beat the bandit chief.
    expect(estimateRisk({ army: { infantry: 10 }, morale: 80, commander: "self", strategy: 10, tactic: "balanced", target: ch1.boss!.target }).winChance).toBeGreaterThan(0.9);
    // Chapter 3: power 250 with the bandit banner gives a real but not certain chance; the starting army has none.
    const morven = ch3.boss!.target;
    const army250 = { infantry: 21 }; // 21 × 12 = 252
    const withBanner = estimateRisk({ army: army250, morale: 85, commander: "self", strategy: 20, tactic: "balanced", target: morven, powerBonus: 0.05 });
    expect(withBanner.winChance).toBeGreaterThan(0.3);
    expect(estimateRisk({ army: { infantry: 5 }, morale: 80, commander: "self", strategy: 10, tactic: "balanced", target: morven }).winChance).toBe(0);
  });
});

describe("items and achievements", () => {
  it("items add flat income and battle power, each counted once", () => {
    expect(itemEffects(["father_seal", "ledger_book", "ledger_book"]).economy).toEqual({ gold: 15, food: 0, knowledge: 0, influence: 2 });
    expect(itemEffects(["bandit_banner", "dawn_blade", "unknown"]).battlePower).toBe(0.15);
    const base = { army: { infantry: 20 }, morale: 80, commander: "self" as const, strategy: 10, tactic: "balanced" as const, target: ch3.boss!.target, seed: 3 };
    expect(resolveBattle({ ...base, powerBonus: 0.15 }).attackerBase).toBeCloseTo(resolveBattle(base).attackerBase * 1.15, 1);
    // Bonus is capped: no stack of items can make the army invincible.
    expect(resolveBattle({ ...base, powerBonus: 5 }).attackerBase).toBeCloseTo(resolveBattle(base).attackerBase * 1.5, 1);
  });

  it("achievements unlock from facts and never twice", () => {
    const f = facts({ questsCompleted: 12, buildings: 1, battlesWon: 5 });
    expect(earnedAchievements(f, []).sort()).toEqual(["conqueror_5", "first_building", "first_quest", "first_victory", "quests_10"]);
    expect(earnedAchievements(f, ["first_quest", "quests_10"]).sort()).toEqual(["conqueror_5", "first_building", "first_victory"]);
    expect(earnedAchievements(facts(), [])).toEqual([]);
  });

  it("scenes address the player by name", () => {
    expect(fillHero(ch1.intro.lines[1].text, "Игорь")).toContain("Игорь, я Орион");
  });
});
