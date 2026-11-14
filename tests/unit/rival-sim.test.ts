import { describe, expect, it } from "vitest";
import { KAEL, SIMULATION_VERSION } from "@/data/rival/kael";
import { SKILL_CODES, type SkillCode } from "@/data/skills";
import {
  countPendingDays,
  pendingDays,
  simulateBatch,
  simulateRivalDay,
  type RivalState,
} from "@/engine/simulation/rival";
import { addDays, formatLocalDate, parseLocalDate } from "@/lib/time";

function freshState(seed = 12345): RivalState {
  return {
    version: SIMULATION_VERSION,
    rngSeed: seed,
    params: {
      discipline: KAEL.disciplineFactor,
      learning: KAEL.learningFactor,
      risk: KAEL.riskTolerance,
      dailyMinutes: KAEL.dailyMinutes,
    },
    fatigue: 0,
    totalXp: 0,
    skillXp: Object.fromEntries(SKILL_CODES.map((c) => [c, 0])) as Record<SkillCode, number>,
    gold: 500,
  };
}

function runDays(state: RivalState, start: string, n: number) {
  const last = formatLocalDate(addDays(parseLocalDate(start), -1));
  const today = formatLocalDate(addDays(parseLocalDate(start), n));
  return simulateBatch(state, last, today, n);
}

describe("rival simulation", () => {
  it("is deterministic for the same state, day and seed", () => {
    const a = simulateRivalDay(freshState(), "2026-11-14");
    const b = simulateRivalDay(freshState(), "2026-11-14");
    expect(a).toEqual(b);
  });

  it("differs across seeds and days", () => {
    const base = runDays(freshState(1), "2026-01-01", 30).state.totalXp;
    expect(runDays(freshState(2), "2026-01-01", 30).state.totalXp).not.toBe(base);
    expect(runDays(freshState(1), "2026-02-01", 30).state.totalXp).not.toBe(base);
  });

  it("replaying in batches gives the same result as one run", () => {
    const whole = runDays(freshState(), "2026-01-01", 60);
    let s = freshState();
    let last = "2025-12-31";
    const today = "2026-03-02";
    let remaining = Infinity;
    while (remaining > 0) {
      const r = simulateBatch(s, last, today, 7);
      s = r.state;
      last = r.lastDay;
      remaining = r.remaining;
    }
    expect(s).toEqual(whole.state);
  });

  it("keeps XP, skills and gold consistent and non-negative", () => {
    const r = runDays(freshState(), "2026-01-01", 365);
    const sumSkills = SKILL_CODES.reduce((a, c) => a + r.state.skillXp[c], 0);
    expect(sumSkills).toBe(r.state.totalXp);
    const sumDays = r.days.reduce((a, d) => a + d.xpGained, 0);
    expect(sumDays).toBe(r.state.totalXp);
    for (const d of r.days) {
      expect(d.state.gold).toBeGreaterThanOrEqual(0);
      expect(d.state.fatigue).toBeGreaterThanOrEqual(0);
      expect(d.state.fatigue).toBeLessThanOrEqual(1000);
      for (const a of d.actions) expect(a.xpAwarded).toBeGreaterThanOrEqual(0);
      d.actions.forEach((a, i) => expect(a.actionIndex).toBe(i));
    }
  });

  it("has a realistic pace: rests sometimes, makes mistakes, ~25–80 XP per day", () => {
    const r = runDays(freshState(777), "2026-01-01", 365);
    const avg = r.state.totalXp / 365;
    expect(avg).toBeGreaterThan(25);
    expect(avg).toBeLessThan(80);
    const all = r.days.flatMap((d) => d.actions);
    expect(all.some((a) => a.outcome === "REST")).toBe(true);
    expect(all.some((a) => a.outcome === "FAIL")).toBe(true);
    expect(all.some((a) => a.outcome === "PARTIAL")).toBe(true);
    // Kael favours trading over hebrew by personality.
    expect(r.state.skillXp.trading_analysis).toBeGreaterThan(r.state.skillXp.hebrew);
  });

  it("never plans more than his available minutes", () => {
    const r = runDays(freshState(), "2026-01-01", 120);
    for (const d of r.days) {
      const planned = d.actions.reduce((a, x) => a + x.plannedMinutes, 0);
      expect(planned).toBeLessThanOrEqual(d.availableMinutes);
    }
  });

  it("simulates a year quickly", () => {
    const t = performance.now();
    runDays(freshState(), "2025-01-01", 365);
    expect(performance.now() - t).toBeLessThan(500);
  });

  it("only simulates finished days", () => {
    expect(pendingDays("2026-11-13", "2026-11-14")).toEqual([]);
    expect(pendingDays("2026-11-12", "2026-11-14")).toEqual(["2026-11-13"]);
    expect(pendingDays("2026-02-27", "2026-03-02")).toEqual(["2026-02-28", "2026-03-01"]);
    expect(countPendingDays("2026-11-13", "2026-11-14")).toBe(0);
    expect(countPendingDays("2025-11-13", "2026-11-14")).toBe(365);
  });
});
