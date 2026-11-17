import type { NpcState } from "./types";

export function addCourtDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function isNpcAway(npc: Pick<NpcState, "absentUntilDay"> | undefined, day: string): boolean {
  return !!npc?.absentUntilDay && day < npc.absentUntilDay;
}
