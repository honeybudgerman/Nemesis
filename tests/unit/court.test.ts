import { describe, expect, it } from "vitest";
import { COURT_EVENTS, EVENT_BY_CODE } from "@/data/court/events";
import { NPC_BY_CODE, NPCS, STARTING_RELATIONS } from "@/data/court/npcs";
import type { CourtFacts, NpcState } from "@/data/court/types";
import { TERRITORIES } from "@/data/realm/map";
import {
  assignmentChanges,
  buildChanges,
  commanderSkill,
  courtEconomyBonus,
  eligibleEvents,
  interactionBlocked,
  interactionDeltas,
  newcomers,
  pickDailyEvent,
  questLog,
  resolveChoice,
  statusAfter,
} from "@/engine/court/court";
import { dailyProduction, type EconomyState } from "@/engine/realm/economy";
import { commanderModifier } from "@/engine/realm/battle";

function facts(over: Partial<CourtFacts> = {}): CourtFacts {
  const npcs: Record<string, NpcState> = {};
  for (const n of NPCS) npcs[n.code] = { code: n.code, stats: { ...n.start }, status: "STRANGERS", position: null, recruited: !n.joins, lastInteractionDay: null, version: 0 };
  return {
    day: "2026-11-20",
    heroName: "Игорь",
    heroLevel: 3,
    npcs,
    resolved: {},
    open: [],
    territories: Object.fromEntries(TERRITORIES.map((t) => [t.code, t.owner])),
    resources: { gold: 500, food: 200, knowledge: 0, influence: 10 },
    morale: 80,
    buildings: { palace: 0, academy: 0, barracks: 0, castle: 1 },
    ...over,
  };
}

function withNpc(f: CourtFacts, code: string, patch: Partial<Omit<NpcState, "stats">> & { stats?: Partial<NpcState["stats"]> }): CourtFacts {
  const n = f.npcs[code];
  return { ...f, npcs: { ...f.npcs, [code]: { ...n, ...patch, stats: { ...n.stats, ...patch.stats } } } };
}

describe("court data", () => {
  it("has 5 main characters with 3-step storylines, at most 10 characters, all adults", () => {
    expect(NPCS.length).toBeLessThanOrEqual(10);
    expect(NPCS.filter((n) => n.major)).toHaveLength(5);
    for (const n of NPCS) expect(n.age).toBeGreaterThanOrEqual(18);
    for (const n of NPCS.filter((x) => x.major)) {
      expect(COURT_EVENTS.filter((e) => e.kind === "quest" && e.npc === n.code).map((e) => e.step)).toEqual([1, 2, 3]);
    }
    for (const r of STARTING_RELATIONS) expect(r.a < r.b).toBe(true);
    for (const e of COURT_EVENTS) for (const p of e.participants) expect(NPC_BY_CODE[p]).toBeDefined();
  });
});

describe("relationship status", () => {
  const liara = NPC_BY_CODE.liara;
  const s = (affection: number, trust: number) => ({ ...liara.start, affection, trust });
  it("friendship and closeness follow the stats; meeting makes acquaintances", () => {
    expect(statusAfter(liara, "STRANGERS", s(25, 30))).toBe("STRANGERS");
    expect(statusAfter(liara, "STRANGERS", s(25, 30), { met: true })).toBe("ACQUAINTED");
    expect(statusAfter(liara, "ACQUAINTED", s(45, 35))).toBe("FRIENDS");
    expect(statusAfter(liara, "FRIENDS", s(65, 55))).toBe("CLOSE");
    expect(statusAfter(liara, "CLOSE", s(45, 35))).toBe("FRIENDS");
  });
  it("romance never comes from stats alone and breaks when affection collapses", () => {
    expect(statusAfter(liara, "CLOSE", s(100, 100))).toBe("CLOSE");
    expect(statusAfter(liara, "CLOSE", s(70, 60), { explicit: "ROMANCE" })).toBe("ROMANCE");
    expect(statusAfter(NPC_BY_CODE.torvald, "CLOSE", s(70, 60), { explicit: "ROMANCE" })).toBe("CLOSE");
    expect(statusAfter(liara, "ROMANCE", s(29, 60))).toBe("BROKEN");
    expect(statusAfter(liara, "BROKEN", s(56, 52))).toBe("FRIENDS");
  });
});

describe("interactions", () => {
  it("one per character per day; walks need friendship; gifts need gold", () => {
    const f = facts();
    expect(interactionBlocked(f.npcs.liara, "talk", f.day, 500)).toBeNull();
    expect(interactionBlocked({ ...f.npcs.liara, lastInteractionDay: f.day }, "talk", f.day, 500)).toMatch(/Сегодня/);
    expect(interactionBlocked(f.npcs.liara, "walk", f.day, 500)).toMatch(/дружба/);
    expect(interactionBlocked(f.npcs.liara, "gift", f.day, 10)).toMatch(/золота/);
    expect(interactionBlocked(f.npcs.rein, "talk", f.day, 500)).toMatch(/нет при дворе/);
  });

  it("likes and dislikes shape the effect, and it is deterministic per seed", () => {
    const f = facts();
    const counsel = interactionDeltas(f, "torvald", "counsel", 1).torvald;
    const gift = interactionDeltas(f, "torvald", "gift", 1).torvald;
    expect(counsel.trust).toBeGreaterThanOrEqual(4);
    expect(gift.affection ?? 0).toBeLessThanOrEqual(2);
    expect(interactionDeltas(f, "liara", "talk", 99)).toEqual(interactionDeltas(f, "liara", "talk", 99));
  });

  it("gifts cannot buy affection beyond trust", () => {
    const f = withNpc(facts(), "selvina", { stats: { affection: 40, trust: 25 } });
    expect(interactionDeltas(f, "selvina", "gift", 3).selvina.affection ?? 0).toBe(0);
  });

  it("time alone with one companion makes a close companion jealous", () => {
    let f = withNpc(facts(), "selvina", { status: "ROMANCE", stats: { jealousy: 66 } });
    f = withNpc(f, "liara", { status: "FRIENDS" });
    const d = interactionDeltas(f, "liara", "walk", 5);
    expect(d.selvina).toEqual({ jealousy: 6, loyalty: -2 });
    expect(interactionDeltas(f, "liara", "talk", 5).selvina).toBeUndefined();
  });

  it("changes are clamped to 0–100 and carry the expected version", () => {
    const f = withNpc(facts(), "bram", { version: 7, stats: { loyalty: 98 } });
    const ch = buildChanges(f, { bram: { loyalty: 10, trust: -99 } }, { met: ["bram"] });
    expect(ch.npcs[0]).toMatchObject({ code: "bram", expectedVersion: 7, status: "ACQUAINTED" });
    expect(ch.npcs[0].stats.loyalty).toBe(100);
    expect(ch.npcs[0].stats.trust).toBe(0);
  });
});

describe("positions", () => {
  it("bonuses follow skills, need loyalty, and reach the economy", () => {
    const f = withNpc(facts(), "bram", { position: "treasurer" });
    expect(courtEconomyBonus(Object.values(f.npcs), f)).toEqual({ gold: 14, food: 0, knowledge: 0, influence: 0 });
    const reform = { ...f, resolved: { bram_3: { choice: "reform", day: "2026-11-01" } } };
    expect(courtEconomyBonus(Object.values(reform.npcs), reform).gold).toBe(28);
    const disloyal = withNpc(f, "bram", { stats: { loyalty: 20 } });
    expect(courtEconomyBonus(Object.values(disloyal.npcs), disloyal).gold).toBe(0);

    const eco: EconomyState = { resources: { gold: 0, food: 0, knowledge: 0, influence: 0, command_points: 0 }, morale: 80, buildings: [], territories: [], army: {}, bonus: { gold: 14 } };
    expect(dailyProduction(eco, new Date()).gold).toBe(14);
  });

  it("a loyal commander leads the army with his military skill", () => {
    const f = facts();
    expect(commanderSkill("torvald", f.npcs.torvald.stats, f)).toBe(75);
    expect(commanderSkill("torvald", f.npcs.torvald.stats, { resolved: { torvald_3: { choice: "accept", day: "x" } } })).toBe(85);
    expect(commanderSkill("torvald", { ...f.npcs.torvald.stats, loyalty: 10 }, f)).toBeNull();
    expect(commanderModifier("general", 75)).toBeCloseTo(1.375);
  });

  it("appointing moves the position and upsets the passed-over ambitious rival", () => {
    let f = withNpc(facts(), "torvald", { position: "commander" });
    f = withNpc(f, "rein", { recruited: true });
    const ch = assignmentChanges(f, "commander", "rein");
    const rein = ch.npcs.find((n) => n.code === "rein")!;
    const torvald = ch.npcs.find((n) => n.code === "torvald")!;
    expect(rein.position).toBe("commander");
    expect(torvald.position).toBeNull();
    expect(torvald.stats.loyalty).toBe(60 - 8);
  });
});

describe("events", () => {
  it("one event a day, storylines first, deterministic", () => {
    const f = withNpc(facts(), "torvald", { status: "ACQUAINTED" });
    const e = pickDailyEvent(f, 42, false);
    expect(e?.kind).toBe("quest");
    expect(pickDailyEvent(f, 42, false)).toBe(e);
    expect(pickDailyEvent(f, 42, true)).toBeNull();
    expect(pickDailyEvent({ ...f, open: ["a", "b"] }, 42, false)).toBeNull();
  });

  it("the next storyline step waits for another day and the right relationship", () => {
    let f = withNpc(facts(), "liara", { status: "FRIENDS", stats: { affection: 60, trust: 50 } });
    f = { ...f, resolved: { liara_1: { choice: "escort", day: f.day } } };
    expect(EVENT_BY_CODE.liara_2.requires(f)).toBe(false);
    f = { ...f, resolved: { liara_1: { choice: "escort", day: "2026-11-19" } } };
    expect(EVENT_BY_CODE.liara_2.requires(f)).toBe(true);
    expect(questLog(f, "liara").map((q) => q.state)).toEqual(["done", "ready", "locked"]);
  });

  it("romance needs her consent: the same choice can be declined", () => {
    const base = withNpc(facts(), "liara", { status: "CLOSE", stats: { affection: 60, trust: 50 } });
    const no = resolveChoice(base, "liara_2", "close");
    expect(no.changes.npcs[0].status).toBe("CLOSE");
    const yes = resolveChoice(withNpc(base, "liara", { stats: { affection: 70, trust: 60 } }), "liara_2", "close");
    expect(yes.changes.npcs[0].status).toBe("ROMANCE");
  });

  it("choices cost resources and can bring a territory peacefully", () => {
    const f = facts();
    const pay = resolveChoice(f, "torvald_1", "pay");
    expect(pay.changes.resources.gold).toBe(-80);
    expect(pay.changes.morale).toBe(5);
    const alliance = resolveChoice(withNpc(f, "liara", { status: "CLOSE" }), "liara_3", "alliance");
    expect(alliance.changes.territory).toBe("merchant_port");
    const lost = { ...f, territories: { ...f.territories, merchant_port: "RIVAL" as const } };
    expect(EVENT_BY_CODE.liara_3.choices[0].unavailable!(lost)).toMatch(/Каэлем/);
    expect(resolveChoice(lost, "liara_3", "alliance").changes.territory).toBeNull();
  });

  it("secondary characters join when their condition is met", () => {
    const f = facts({ territories: { ...facts().territories, river_fords: "HERO", whisper_woods: "HERO" }, buildings: { palace: 1, academy: 0, barracks: 0, castle: 1 } });
    expect(newcomers(f).sort()).toEqual(["ida", "rein"]);
    expect(newcomers({ ...facts(), resolved: { meyrin_1: { choice: "trust", day: "x" } } })).toEqual(["corvin"]);
  });
});

describe("romance recovery", () => {
  for (const [code, confession] of [["liara", "close"], ["selvina", "stay"]] as const) {
    it(`${code}: hints and second confession retain a chance after an early attempt`, () => {
      let f = withNpc(facts(), code, { status: "CLOSE", stats: { affection: 50, trust: 45 } });
      const choice = EVENT_BY_CODE[`${code}_2`].choices.find((c) => c.code === confession)!;
      expect(typeof choice.hint).toBe("function");
      expect(typeof choice.hint === "function" && choice.hint(f)).toContain("50/65");
      expect(resolveChoice(f, `${code}_2`, confession).outcome.status).toBeUndefined();
      f.resolved[`${code}_2`] = { choice: confession, day: f.day };
      f = withNpc(f, code, { stats: { affection: 65, trust: 55 } });
      const retry = EVENT_BY_CODE[`${code}_second_confession`];
      expect(retry.requires(f)).toBe(false);
      f = { ...f, day: "2026-11-21" };
      expect(retry.requires(f)).toBe(true);
      expect(resolveChoice(f, retry.code, "confess").changes.npcs[0].status).toBe("ROMANCE");
      f = withNpc(f, code, { brokenSinceDay: "2026-11-01" });
      expect(retry.requires(f)).toBe(false);
      expect(resolveChoice(f, `${code}_2`, confession).outcome.status).toBeUndefined();
    });

    it(`${code}: commitment follows every third-step political choice`, () => {
      const event = EVENT_BY_CODE[`${code}_commitment`];
      for (const choice of EVENT_BY_CODE[`${code}_3`].choices) {
        let f = withNpc(facts(), code, { status: "ROMANCE", stats: { affection: 75, trust: 60 } });
        f.resolved[`${code}_3`] = { choice: choice.code, day: "2026-11-19" };
        expect(event.requires(f)).toBe(true);
        expect(resolveChoice(f, event.code, "commit").changes.npcs[0].status).toBe("PARTNER");
        f = withNpc(f, code, { stats: { trust: 59 } });
        expect(event.requires(f)).toBe(false);
      }
    });

    it(`${code}: reconciliation requires seven days even after returning to friendship`, () => {
      const event = EVENT_BY_CODE[`${code}_reconcile`];
      let f = withNpc(facts(), code, { status: "BROKEN", brokenSinceDay: "2026-11-14", stats: { affection: 65, trust: 55 } });
      expect(event.requires(f)).toBe(false);
      f = { ...f, day: "2026-11-21" };
      expect(event.requires(f)).toBe(true);
      expect(resolveChoice(f, event.code, "reconcile").changes.npcs[0].status).toBe("ROMANCE");
      f = withNpc(f, code, { status: "FRIENDS" });
      expect(event.requires(f)).toBe(true);
      f = withNpc(f, code, { stats: { trust: 54 } });
      expect(event.requires(f)).toBe(false);
      f = withNpc(f, code, { brokenSinceDay: null, status: "BROKEN", stats: { trust: 55 } });
      expect(event.requires(f)).toBe(false);
    });
  }

  it("expulsion is a deliberate end, and recovery scenes never become quest steps", () => {
    let f = withNpc(facts(), "liara", { status: "BROKEN", brokenSinceDay: "2026-11-01", stats: { affection: 100, trust: 100 } });
    f.resolved.liara_2 = { choice: "expel", day: "2026-11-01" };
    expect(EVENT_BY_CODE.liara_reconcile.requires(f)).toBe(false);
    expect(questLog(f, "liara")).toHaveLength(3);
    expect(pickDailyEvent(f, 1, true)).toBeNull();
    f = withNpc(f, "liara", { status: "PARTNER" });
    expect(EVENT_BY_CODE.liara_commitment.requires(f)).toBe(false);
  });
});


describe("subsequent relationship cycles", () => {
  it("allows a breakup on the reconciliation day and commitment after a later reconciliation", () => {
    let f = withNpc(facts({ day: "2026-11-28" }), "liara", { status: "FRIENDS", brokenSinceDay: "2026-11-21", stats: { affection: 75, trust: 60 } });
    f.resolved.liara_reconcile = { choice: "reconcile", day: "2026-11-21" };
    expect(eligibleEvents(f).map((e) => e.code)).toContain("liara_reconcile");
    f = withNpc(f, "liara", { status: "ROMANCE", brokenSinceDay: null });
    f.resolved.liara_reconcile = { choice: "reconcile", day: "2026-11-28" };
    f.resolved.liara_commitment = { choice: "commit", day: "2026-11-20" };
    f.resolved.liara_3 = { choice: "trade", day: "2026-11-19" };
    expect(eligibleEvents(f).map((e) => e.code)).toContain("liara_commitment");
    f.resolved.liara_commitment = { choice: "decline", day: "2026-11-28" };
    expect(eligibleEvents(f).map((e) => e.code)).not.toContain("liara_commitment");
  });
});
