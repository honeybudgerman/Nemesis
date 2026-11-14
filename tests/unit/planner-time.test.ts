import { describe, expect, it } from "vitest";
import { fitToBudget, planDailyQuests, planMonthlyQuests, planWeeklyQuests } from "@/engine/quests/planner";
import { questPeriods, isoWeekday, parseLocalDate, startOfLocalDay } from "@/lib/time";

const PID = "11111111-1111-1111-1111-111111111111";
const DEADLINE = new Date("2026-11-15T00:00:00Z");

describe("daily quest planner", () => {
  it("creates 3 main quests + 1 optional", () => {
    const qs = planDailyQuests(PID, "2026-11-14", 55, DEADLINE);
    expect(qs).toHaveLength(4);
    expect(qs.filter((q) => !q.isOptional)).toHaveLength(3);
    expect(qs.filter((q) => q.isOptional)).toHaveLength(1);
  });

  it("is deterministic for the same profile and date", () => {
    const a = planDailyQuests(PID, "2026-11-14", 55, DEADLINE);
    const b = planDailyQuests(PID, "2026-11-14", 55, DEADLINE);
    expect(a).toEqual(b);
  });

  it("keeps main quests within the daily budget", () => {
    for (const budget of [30, 40, 45, 55, 60, 120]) {
      for (let d = 1; d <= 28; d++) {
        const date = `2026-02-${String(d).padStart(2, "0")}`;
        const main = planDailyQuests(PID, date, budget, DEADLINE).filter((q) => !q.isOptional);
        const total = main.reduce((s, q) => s + q.estimatedMinutes, 0);
        expect(total).toBeLessThanOrEqual(budget);
        for (const q of main) expect(q.baseXp).toBeGreaterThan(0);
      }
    }
  });

  it("covers language, trading and discipline", () => {
    const main = planDailyQuests(PID, "2026-11-14", 55, DEADLINE).filter((q) => !q.isOptional);
    const cats = main.map((q) => q.category);
    expect(["english", "hebrew"]).toContain(cats[0]);
    expect(["trading_analysis", "risk_management"]).toContain(cats[1]);
    expect(["discipline", "time_management"]).toContain(cats[2]);
  });

  it("fitToBudget shrinks proportionally", () => {
    expect(fitToBudget([15, 20, 20], 55)).toEqual([15, 20, 20]);
    expect(fitToBudget([15, 20, 20], 30)).toEqual([8, 10, 10]);
  });

  it("weekly and monthly plans have 2 unique quests each", () => {
    const w = planWeeklyQuests(PID, "2026-11-09", DEADLINE);
    const m = planMonthlyQuests(PID, "2026-11-01", DEADLINE);
    expect(new Set(w.map((q) => q.templateCode)).size).toBe(2);
    expect(new Set(m.map((q) => q.templateCode)).size).toBe(2);
    expect(w.every((q) => q.frequency === "WEEKLY")).toBe(true);
    expect(m.every((q) => q.frequency === "MONTHLY")).toBe(true);
  });
});

describe("time zones", () => {
  it("computes the local day in the user's zone", () => {
    // 22:30 UTC on Nov 14 is already Nov 15 in Jerusalem (UTC+2)
    const p = questPeriods(new Date("2026-11-14T22:30:00Z"), "Asia/Jerusalem");
    expect(p.today).toBe("2026-11-15");
    expect(p.dayStart.toISOString()).toBe("2026-11-14T22:00:00.000Z");
    expect(p.dayEnd.toISOString()).toBe("2026-11-15T22:00:00.000Z");
  });

  it("weeks start on Monday and months on the 1st", () => {
    const p = questPeriods(new Date("2026-11-14T12:00:00Z"), "Europe/Moscow");
    expect(p.weekStart).toBe("2026-11-09");
    expect(isoWeekday(parseLocalDate(p.weekStart))).toBe(1);
    expect(p.monthStart).toBe("2026-11-01");
    expect(p.monthEnd.toISOString()).toBe("2026-11-30T21:00:00.000Z");
  });

  it("handles DST transitions", () => {
    // Europe/Berlin switches to summer time on 2026-03-29
    expect(startOfLocalDay({ year: 2026, month: 3, day: 29 }, "Europe/Berlin").toISOString()).toBe(
      "2026-03-28T23:00:00.000Z",
    );
    expect(startOfLocalDay({ year: 2026, month: 3, day: 30 }, "Europe/Berlin").toISOString()).toBe(
      "2026-03-29T22:00:00.000Z",
    );
  });
});
