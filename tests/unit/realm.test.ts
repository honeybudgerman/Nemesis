import { describe, expect, it } from "vitest";
import { buildingCost, maxLevelFor } from "@/data/realm/buildings";
import { neighboursOf, TERRITORIES } from "@/data/realm/map";
import { UNITS, unitPower } from "@/data/realm/units";
import { armyPower, estimateRisk, resolveBattle, type BattleInput } from "@/engine/realm/battle";
import { kaelCampaignDay, type WorldTerritory } from "@/engine/realm/campaign";
import { dailyProduction, simulateEconomyDay, type EconomyState } from "@/engine/realm/economy";
import { simulateWorldBatch } from "@/engine/realm/world";

const START = "2026-01-01T00:00:00Z";

function economy(over: Partial<EconomyState> = {}): EconomyState {
  return {
    resources: { gold: 500, food: 200, knowledge: 0, influence: 0, command_points: 3 },
    morale: 80,
    buildings: [{ type: "castle", level: 1, terrain: "plains", completedAt: START }],
    territories: [{ resource: "gold" }],
    army: { infantry: 5 },
    ...over,
  };
}

const world = (): WorldTerritory[] =>
  TERRITORIES.map((t) => ({ code: t.code, owner: t.owner, terrain: t.terrain, garrison: t.garrison, fortification: t.fortification, neighbors: neighboursOf(t.code) }));

const dayEnd = (d: string) => new Date(`${d}T23:59:59Z`);

describe("map", () => {
  it("has 12 territories with symmetric neighbours and the right owners", () => {
    expect(TERRITORIES).toHaveLength(12);
    for (const t of TERRITORIES) for (const n of neighboursOf(t.code)) expect(neighboursOf(n)).toContain(t.code);
    const owners = TERRITORIES.reduce<Record<string, number>>((m, t) => ((m[t.owner] = (m[t.owner] ?? 0) + 1), m), {});
    expect(owners).toEqual({ HERO: 1, RIVAL: 2, NEUTRAL: 5, FACTION: 4 });
    expect(neighboursOf("capital").sort()).toEqual(["river_fords", "whisper_woods"]);
  });
});

describe("buildings and units", () => {
  it("costs grow with level and other buildings stay within castle level + 1", () => {
    expect(buildingCost("farm", 3)).toEqual({ gold: 240, food: 0 });
    expect(maxLevelFor("farm", 1)).toBe(2);
    expect(maxLevelFor("castle", 1)).toBe(5);
  });
  it("unit power is attack + defense + health/10", () => {
    expect(unitPower("infantry")).toBe(4 + 5 + 3);
    expect(armyPower({ infantry: 5 })).toBe(60);
    expect(armyPower({ royal_guard: 2 })).toBe(2 * (10 + 10 + 5) * 1.5);
    expect(UNITS.mages.requires.academy).toBe(1);
  });
});

describe("economy", () => {
  it("produces by fixed rules, pays upkeep and regenerates command points up to the cap", () => {
    const s = economy({
      resources: { gold: 0, food: 0, knowledge: 0, influence: 0, command_points: 2 },
      buildings: [
        { type: "castle", level: 1, terrain: "plains", completedAt: START },
        { type: "farm", level: 2, terrain: "plains", completedAt: START },
      ],
    });
    expect(dailyProduction(s, dayEnd("2026-01-02"))).toEqual({ gold: 10 + 5, food: Math.floor(20 * 2 * 1.25), knowledge: 0, influence: 1 });
    const r = simulateEconomyDay(s, "2026-01-02", dayEnd("2026-01-02"));
    expect(r.result.delta).toEqual({ gold: 15, food: 50 - 5, knowledge: 0, influence: 1, command_points: 1 });
    const r2 = simulateEconomyDay(r.state, "2026-01-03", dayEnd("2026-01-03"));
    expect(r2.result.delta.command_points).toBe(0); // capped at 3 with castle level 1
  });

  it("a building under construction keeps producing at its previous level", () => {
    const b = { type: "farm" as const, level: 2, terrain: "forest" as const, completedAt: "2026-01-05T12:00:00Z" };
    const s = economy({ buildings: [b], territories: [] });
    expect(dailyProduction(s, dayEnd("2026-01-04")).food).toBe(20);
    expect(dailyProduction(s, dayEnd("2026-01-05")).food).toBe(40);
  });

  it("food never goes negative: starvation lowers morale instead", () => {
    const s = economy({ resources: { gold: 0, food: 3, knowledge: 0, influence: 0, command_points: 0 }, army: { cavalry: 10 }, territories: [] });
    const r = simulateEconomyDay(s, "2026-01-02", dayEnd("2026-01-02"));
    expect(r.state.resources.food).toBe(0);
    expect(r.result.starving).toBe(true);
    expect(r.state.morale).toBe(70);
  });
});

describe("battle", () => {
  const base: BattleInput = {
    army: { infantry: 5 },
    morale: 80,
    commander: "self",
    strategy: 10,
    tactic: "balanced",
    target: { terrain: "river", garrison: 18, fortification: 0, resource: "food" },
    seed: 42,
  };

  it("is deterministic per seed and keeps the random modifier within 0.90–1.10", () => {
    expect(resolveBattle(base)).toEqual(resolveBattle(base));
    for (let s = 0; s < 200; s++) {
      const r = resolveBattle({ ...base, seed: s });
      expect(r.attackerRandom).toBeGreaterThanOrEqual(0.9);
      expect(r.attackerRandom).toBeLessThanOrEqual(1.1);
      expect(r.defenderRandom).toBeGreaterThanOrEqual(0.9);
      expect(r.defenderRandom).toBeLessThanOrEqual(1.1);
    }
  });

  it("the starting army can take an easy neighbour; casualties never exceed the army", () => {
    const r = resolveBattle(base);
    expect(r.win).toBe(true);
    expect(r.rewards.food).toBe(30);
    expect(r.garrisonAfter).toBe(10);
    expect((r.casualties.infantry ?? 0) + (r.survivors.infantry ?? 0)).toBe(5);
  });

  it("loses against a fortress, with heavier losses, and gives no rewards", () => {
    const r = resolveBattle({ ...base, target: { terrain: "mountains", garrison: 110, fortification: 3, resource: "influence" } });
    expect(r.win).toBe(false);
    expect(r.rewards).toEqual({ gold: 0, food: 0, influence: 0 });
    expect(r.casualties.infantry).toBeGreaterThanOrEqual(1);
    expect(r.moraleAfter).toBe(70);
  });

  it("tactics trade power for losses; an empty army never wins", () => {
    const strong = { ...base, army: { infantry: 40 }, target: { ...base.target, garrison: 30 } };
    const cautious = resolveBattle({ ...strong, tactic: "cautious" });
    const aggressive = resolveBattle({ ...strong, tactic: "aggressive" });
    expect(aggressive.attackerPower).toBeGreaterThan(cautious.attackerPower);
    expect(aggressive.casualties.infantry ?? 0).toBeGreaterThan(cautious.casualties.infantry ?? 0);
    expect(resolveBattle({ ...base, army: {} }).win).toBe(false);
  });

  it("risk estimate matches outcomes over many seeds", () => {
    const input = { ...base, target: { ...base.target, garrison: 42 } };
    const risk = estimateRisk(input);
    let wins = 0;
    for (let s = 0; s < 2000; s++) if (resolveBattle({ ...input, seed: s }).win) wins++;
    expect(Math.abs(wins / 2000 - risk.winChance)).toBeLessThan(0.05);
    expect(estimateRisk(base).level).toBe("low");
    expect(estimateRisk({ ...base, target: { terrain: "mountains", garrison: 110, fortification: 3, resource: "gold" } }).level).toBe("high");
  });
});

describe("Kael campaigns and world days", () => {
  it("only attacks neutral or faction lands next to his own, on his own schedule", () => {
    let count = 0;
    for (let i = 0; i < 400; i++) {
      const day = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
      const c = kaelCampaignDay(world(), day, 777, 5);
      if (!c) continue;
      count++;
      expect(["stone_hills", "iron_pass", "old_monastery", "merchant_port"]).toContain(c.target);
      expect(c.previousOwner).toBe("FACTION");
    }
    expect(count).toBeGreaterThan(20);
    expect(count).toBeLessThan(70);
    expect(kaelCampaignDay(world(), "2026-03-03", 777, 5)).toEqual(kaelCampaignDay(world(), "2026-03-03", 777, 5));
  });

  it("replaying in batches equals one run, and a year finishes fast", () => {
    const t0 = performance.now();
    const whole = simulateWorldBatch(economy(), world(), { rngSeed: 9, level: 6 }, "2025-12-31", "2027-01-01", dayEnd, 1000);
    expect(performance.now() - t0).toBeLessThan(500);
    expect(whole.days).toHaveLength(365);

    let eco = economy();
    let map = world();
    let last = "2025-12-31";
    let remaining = Infinity;
    while (remaining > 0) {
      const b = simulateWorldBatch(eco, map, { rngSeed: 9, level: 6 }, last, "2027-01-01", dayEnd, 31);
      eco = b.economy;
      map = b.world;
      last = b.lastDay;
      remaining = b.remaining;
    }
    expect(eco).toEqual(whole.economy);
    expect(map).toEqual(whole.world);
    expect(whole.world.filter((t) => t.owner === "HERO").map((t) => t.code)).toEqual(["capital"]);
    expect(whole.economy.resources.food).toBeGreaterThanOrEqual(0);
  });
});
