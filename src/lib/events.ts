import type { GameEventView } from "@/types/game";

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
    default:
      return e.type;
  }
}

export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
