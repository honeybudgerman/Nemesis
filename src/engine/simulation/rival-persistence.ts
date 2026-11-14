/**
 * Pure mapping between database rows and the simulator's RivalState, plus the
 * payload format accepted by the `apply_rival_days` SQL function. Shared by the
 * server service and the integration tests so both exercise the same code.
 */
import { SKILL_CODES, isSkillCode, type SkillCode } from "@/data/skills";
import type { RivalDayResult, RivalState } from "./rival";

export interface RivalProfileRow {
  id: string;
  name: string;
  discipline_factor: number | string;
  learning_factor: number | string;
  risk_tolerance: number | string;
  daily_minutes: number;
  level: number;
  total_xp: number | string;
  fatigue: number;
  last_simulated_day: string;
  simulation_version: number;
  rng_seed: number | string;
}

export function rivalStateFromRows(
  rival: RivalProfileRow,
  skills: { skill_code: string; xp: number | string }[],
  gold: number | string,
): RivalState {
  const skillXp = Object.fromEntries(SKILL_CODES.map((c) => [c, 0])) as Record<SkillCode, number>;
  for (const s of skills) if (isSkillCode(s.skill_code)) skillXp[s.skill_code] = Number(s.xp);
  return {
    version: rival.simulation_version,
    rngSeed: Number(rival.rng_seed),
    params: {
      discipline: Number(rival.discipline_factor),
      learning: Number(rival.learning_factor),
      risk: Number(rival.risk_tolerance),
      dailyMinutes: rival.daily_minutes,
    },
    fatigue: rival.fatigue,
    totalXp: Number(rival.total_xp),
    skillXp,
    gold: Number(gold),
  };
}

export function buildApplyPayload(days: RivalDayResult[], finalState: RivalState) {
  return {
    version: finalState.version,
    days: days.map((d) => ({
      day: d.day,
      gold_delta: d.goldDelta,
      actions: d.actions.map((a) => ({
        action_index: a.actionIndex,
        action_type: a.actionType,
        category: a.category,
        planned_minutes: a.plannedMinutes,
        difficulty: a.difficulty,
        outcome: a.outcome,
        grade: a.grade,
        xp_awarded: a.xpAwarded,
        gold_delta: a.goldDelta,
        narrative: a.narrative,
      })),
    })),
    final: {
      total_xp: finalState.totalXp,
      fatigue: finalState.fatigue,
      skill_xp: finalState.skillXp,
    },
    checkpoint: finalState,
  };
}
