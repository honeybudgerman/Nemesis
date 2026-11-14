import { describe, expect, it } from "vitest";
import {
  levelForXp,
  levelProgress,
  rankForLevel,
  totalXpForLevel,
  xpRequired,
  xpReward,
} from "@/engine/progression/xp";
import { applyDailyCap, baseXpFor, questReward } from "@/engine/progression/rewards";

describe("xpRequired — round(100 × L^1.5)", () => {
  it.each([
    [1, 100],
    [2, 283],
    [3, 520],
    [4, 800],
    [5, 1118],
    [9, 2700],
    [10, 3162],
    [16, 6400],
    [100, 100000],
  ])("level %i → %i", (level, xp) => {
    expect(xpRequired(level)).toBe(xp);
  });

  it("rejects invalid levels", () => {
    expect(() => xpRequired(0)).toThrow(RangeError);
    expect(() => xpRequired(1.5)).toThrow(RangeError);
  });

  it("is a per-transition cost, not cumulative", () => {
    expect(totalXpForLevel(1)).toBe(0);
    expect(totalXpForLevel(2)).toBe(100);
    expect(totalXpForLevel(3)).toBe(383);
    expect(totalXpForLevel(4)).toBe(903);
  });
});

describe("levelProgress — sequential subtraction", () => {
  it("starts at level 1", () => {
    expect(levelProgress(0)).toEqual({ level: 1, xpIntoLevel: 0, xpForNext: 100, ratio: 0 });
  });

  it("levels up exactly on the boundary", () => {
    expect(levelForXp(99)).toBe(1);
    expect(levelForXp(100)).toBe(2);
    expect(levelForXp(382)).toBe(2);
    expect(levelForXp(383)).toBe(3);
  });

  it("reports progress inside the level", () => {
    const p = levelProgress(150);
    expect(p.level).toBe(2);
    expect(p.xpIntoLevel).toBe(50);
    expect(p.xpForNext).toBe(283);
  });

  it("agrees with totalXpForLevel for many levels", () => {
    for (let l = 1; l <= 60; l++) {
      const t = totalXpForLevel(l);
      expect(levelForXp(t)).toBe(l);
      if (t > 0) expect(levelForXp(t - 1)).toBe(l - 1);
    }
  });

  it("rejects negative or fractional XP", () => {
    expect(() => levelProgress(-1)).toThrow(RangeError);
    expect(() => levelProgress(1.5)).toThrow(RangeError);
  });
});

describe("xpReward — grade multipliers", () => {
  it.each([
    ["S", 120],
    ["A", 100],
    ["B", 85],
    ["C", 70],
    ["D", 40],
    ["F", 0],
  ] as const)("grade %s on base 100 → %i", (grade, xp) => {
    expect(xpReward(100, grade)).toBe(xp);
  });

  it("rounds half up without floating point drift", () => {
    expect(xpReward(30, "B")).toBe(26); // 25.5
    expect(xpReward(25, "S")).toBe(30);
    expect(xpReward(23, "B")).toBe(20); // 19.55
    expect(xpReward(5, "C")).toBe(4); // 3.5
  });
});

describe("rewards", () => {
  it("base XP depends only on minutes and difficulty", () => {
    expect(baseXpFor(15, 2)).toBe(23);
    expect(baseXpFor(20, 3)).toBe(36);
    expect(baseXpFor(20, 2)).toBe(30);
    expect(() => baseXpFor(2, 2)).toThrow(RangeError);
    expect(() => baseXpFor(20, 6)).toThrow(RangeError);
  });

  it("gives gold for every quest and knowledge only for study", () => {
    expect(questReward(30, "A", "english")).toEqual({ xp: 30, gold: 15, knowledge: 6 });
    expect(questReward(30, "A", "discipline")).toEqual({ xp: 30, gold: 15, knowledge: 0 });
    expect(questReward(30, "F", "english")).toEqual({ xp: 0, gold: 0, knowledge: 0 });
  });

  it("applies the daily cap for repeatable/manual quests", () => {
    const r = { xp: 40, gold: 20, knowledge: 8 };
    expect(applyDailyCap(r, 0, 60)).toEqual(r);
    expect(applyDailyCap(r, 40, 60)).toEqual({ xp: 20, gold: 10, knowledge: 4 });
    expect(applyDailyCap(r, 60, 60)).toEqual({ xp: 0, gold: 0, knowledge: 0 });
    expect(applyDailyCap(r, 100, 60)).toEqual({ xp: 0, gold: 0, knowledge: 0 });
  });
});

describe("ranks", () => {
  it("maps levels to titles", () => {
    expect(rankForLevel(1)).toBe("Наследник");
    expect(rankForLevel(5)).toBe("Рыцарь");
    expect(rankForLevel(14)).toBe("Барон");
    expect(rankForLevel(30)).toBe("Король");
  });
});
