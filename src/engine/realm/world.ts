/**
 * One "world day" = the hero's economy + Kael's campaign schedule. Replayed for
 * finished days only, in bounded batches (same pattern as Kael's simulation).
 */
import { pendingDays } from "@/engine/simulation/rival";
import { kaelCampaignDay, kaelHomeGarrison, type KaelCampaign, type WorldTerritory } from "./campaign";
import { simulateEconomyDay, type EconomyDay, type EconomyState, type Resources } from "./economy";

export interface WorldBatch {
  days: EconomyDay[];
  campaigns: KaelCampaign[];
  economy: EconomyState;
  world: WorldTerritory[];
  totals: Resources;
  lastDay: string;
  remaining: number;
}

export function simulateWorldBatch(
  economy: EconomyState,
  world: WorldTerritory[],
  rival: { rngSeed: number; level: number } | null,
  lastDay: string,
  today: string,
  dayEnd: (day: string) => Date,
  maxDays: number,
): WorldBatch {
  const all = pendingDays(lastDay, today);
  const batch = all.slice(0, maxDays);
  let eco = economy;
  let map = world.map((t) => ({ ...t }));
  const days: EconomyDay[] = [];
  const campaigns: KaelCampaign[] = [];
  const totals: Resources = { gold: 0, food: 0, knowledge: 0, influence: 0, command_points: 0 };

  for (const day of batch) {
    const r = simulateEconomyDay(eco, day, dayEnd(day));
    eco = r.state;
    days.push(r.result);
    for (const k of Object.keys(totals) as (keyof Resources)[]) totals[k] += r.result.delta[k];

    if (rival) {
      map = map.map((t) => {
        const g = t.owner === "RIVAL" ? kaelHomeGarrison(t.code, rival.level) : null;
        return g !== null && g > t.garrison ? { ...t, garrison: g } : t;
      });
      const c = kaelCampaignDay(map, day, rival.rngSeed, rival.level);
      if (c) {
        campaigns.push(c);
        map = map.map((t) =>
          t.code === c.target
            ? { ...t, owner: c.win ? "RIVAL" : t.owner, garrison: c.garrisonAfter, fortification: c.fortificationAfter }
            : t,
        );
      }
    }
  }
  return {
    days,
    campaigns,
    economy: eco,
    world: map,
    totals,
    lastDay: batch.length ? batch[batch.length - 1] : lastDay,
    remaining: all.length - batch.length,
  };
}
