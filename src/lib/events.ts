import { BUILDINGS, BUILDING_TYPES } from "@/data/realm/buildings";
import { UNITS, UNIT_TYPES } from "@/data/realm/units";
import type { GameEventView } from "@/types/game";

const buildingName = (v: unknown) => ((BUILDING_TYPES as readonly unknown[]).includes(v) ? BUILDINGS[v as (typeof BUILDING_TYPES)[number]].name : "постройка");
const unitName = (v: unknown) => ((UNIT_TYPES as readonly unknown[]).includes(v) ? UNITS[v as (typeof UNIT_TYPES)[number]].name : "войска");

/** Human-readable chronicle line for a game event. Text is rendered as plain React text (escaped). */
export function describeEvent(e: GameEventView): string {
  const p = e.payload;
  switch (e.type) {
    case "GAME_STARTED":
      return `Основано королевство «${String(p.kingdom_name ?? "")}». Правитель ${String(p.hero_name ?? "")} принял наследство.`;
    case "QUEST_COMPLETED":
      return `Выполнено: «${String(p.title ?? "задание")}» (+${Number(p.xp ?? 0)} XP, +${Number(p.gold ?? 0)} золота)`;
    case "LEVEL_UP":
      return `Достигнут уровень ${Number(p.to ?? 0)}. Титул: ${String(p.rank ?? "")}`;
    case "RIVAL_APPEARED":
      return `На горизонте появился соперник: ${String(p.name ?? "Каэль")}, правитель королевства «${String(p.kingdom_name ?? "")}».`;
    case "RIVAL_LEVEL_UP":
      return `Каэль достиг уровня ${Number(p.to ?? 0)}. Титул: ${String(p.rank ?? "")}`;
    case "MENTOR_PLAN":
      return `Орион составил план на день: заданий — ${Number(p.quests ?? 0)}.`;
    case "REALM_FOUNDED":
      return "Картографы составили карту королевства. Соседние земли ждут своего правителя.";
    case "BUILDING_STARTED":
      return `Началось строительство: ${buildingName(p.type)} ${Number(p.level ?? 0)} ур. (${String(p.territory ?? "")}).`;
    case "UNITS_RECRUITED":
      return `В армию нанято: ${unitName(p.unit_type)} × ${Number(p.quantity ?? 0)}.`;
    case "BATTLE_WON":
      return `Победа в битве: ${String(p.territory ?? "")} теперь ваша земля.`;
    case "BATTLE_LOST":
      return `Поражение у ${String(p.territory ?? "")}. Армия отступила.`;
    case "KAEL_CONQUEST":
      return `Каэль захватил ${String(p.territory ?? "")}.`;
    default:
      return e.type;
  }
}

export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
