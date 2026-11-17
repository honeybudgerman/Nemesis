import { POSITION_DEFS, POSITIONS, RELATIONSHIP_STATUSES, STATUS_LABELS, updateCourtNames } from "@/data/court/npcs";
import { BUILDINGS, BUILDING_TYPES } from "@/data/realm/buildings";
import { UNITS, UNIT_TYPES } from "@/data/realm/units";
import { CHAPTER_BY_CODE } from "@/data/story/chapters";
import { ACHIEVEMENT_BY_CODE } from "@/data/story/rewards";
import type { GameEventView } from "@/types/game";
import type { TimelineCategory } from "@/types/story";

const buildingName = (v: unknown) => ((BUILDING_TYPES as readonly unknown[]).includes(v) ? BUILDINGS[v as (typeof BUILDING_TYPES)[number]].name : "постройка");
const statusName = (v: unknown) => ((RELATIONSHIP_STATUSES as readonly unknown[]).includes(v) ? STATUS_LABELS[v as (typeof RELATIONSHIP_STATUSES)[number]] : "отношения изменились");
const positionName = (v: unknown) => ((POSITIONS as readonly unknown[]).includes(v) ? POSITION_DEFS[v as (typeof POSITIONS)[number]].name : "должность");
const chapterName = (v: unknown) => {
  const c = CHAPTER_BY_CODE[String(v)];
  return c ? `Глава ${c.number}. ${c.title}` : "Глава";
};
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
    case "COURT_FOUNDED":
      return "При дворе собрались первые придворные. Их судьбы теперь связаны с вашей.";
    case "COURT_JOINED":
      return `Ко двору присоединяется ${updateCourtNames(String(p.name ?? "новый придворный"))}.`;
    case "COURT_RELATIONSHIP":
      return `${updateCourtNames(String(p.name ?? ""))}: ${statusName(p.to).toLowerCase()}.`;
    case "COURT_EVENT":
      return `${updateCourtNames(String(p.title ?? "Событие при дворе"))}: ${updateCourtNames(String(p.choice ?? ""))}.`;
    case "POSITION_ASSIGNED":
      return p.npc ? `${String(p.name ?? "")} назначен(а): ${positionName(p.position).toLowerCase()}.` : `Должность «${positionName(p.position)}» свободна.`;
    case "TERRITORY_JOINED":
      return `${String(p.territory ?? "Территория")} мирно присоединяется к королевству.`;
    case "KAEL_CONQUEST":
      return `Каэль захватил ${String(p.territory ?? "")}.`;
    case "CHAPTER_STARTED":
      return `Начинается «${chapterName(p.chapter)}».`;
    case "CHAPTER_COMPLETED":
      return `Завершена «${chapterName(p.chapter)}».`;
    case "STORY_DECISION":
      return `${String(p.title ?? "Решение")}: ${String(p.choice ?? "")}.`;
    case "BOSS_DEFEATED":
      return `Повержен ${String(p.name ?? "сюжетный противник")}.`;
    case "BOSS_REPELLED":
      return `${String(p.name ?? "Противник")} отбил штурм. Армия отступила.`;
    case "ACHIEVEMENT_UNLOCKED":
      return `Достижение: «${ACHIEVEMENT_BY_CODE[String(p.code)]?.name ?? String(p.name ?? "")}».`;
    default:
      return e.type;
  }
}

const CATEGORY: Record<string, TimelineCategory> = {
  BATTLE_WON: "battles",
  BATTLE_LOST: "battles",
  BOSS_DEFEATED: "battles",
  BOSS_REPELLED: "battles",
  COURT_FOUNDED: "politics",
  COURT_JOINED: "politics",
  COURT_RELATIONSHIP: "politics",
  COURT_EVENT: "politics",
  POSITION_ASSIGNED: "politics",
  TERRITORY_JOINED: "politics",
  STORY_DECISION: "politics",
  RIVAL_APPEARED: "rivalry",
  RIVAL_LEVEL_UP: "rivalry",
  KAEL_CONQUEST: "rivalry",
  CHAPTER_STARTED: "story",
  CHAPTER_COMPLETED: "story",
};

/** Chronicle section of an event (ТЗ §13: история королевства по разделам). */
export function eventCategory(type: string): TimelineCategory {
  return CATEGORY[type] ?? "kingdom";
}

export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
