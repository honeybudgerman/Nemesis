/**
 * Items, titles and achievements (ТЗ §13, §5.17). Items give small passive
 * bonuses to the kingdom; titles are cosmetic; achievements only celebrate
 * progress that already happened. None of them ever give XP: XP comes only
 * from real-life quests. Achievements reward steady, healthy effort and never
 * push the player towards risky or harmful actions (ТЗ §1).
 */
import type { ProgressMetric } from "./progress";

export interface ItemDef {
  code: string;
  name: string;
  icon: string;
  description: string;
  /** Flat daily income. */
  economy?: Partial<Record<"gold" | "food" | "knowledge" | "influence", number>>;
  /** Additive battle power bonus: 0.05 = +5%. */
  battlePower?: number;
}

export const ITEMS: readonly ItemDef[] = [
  { code: "father_seal", name: "Печать отца", icon: "🔏", description: "Перстень старого короля. Его печать открывает двери и сердца.", economy: { influence: 2 } },
  { code: "bandit_banner", name: "Знамя Грыза", icon: "🚩", description: "Трофей из Шепчущего леса. Солдаты бьются злее, когда видят его.", battlePower: 0.05 },
  { code: "ledger_book", name: "Счётная книга", icon: "📒", description: "Подарок Брама. С ней ни одна монета не теряется по дороге в казну.", economy: { gold: 15 } },
  { code: "dawn_blade", name: "Клинок Рассвета", icon: "🗡️", description: "Меч Морвена, перекованный в королевской кузнице.", battlePower: 0.1 },
];

export const ITEM_BY_CODE: Readonly<Record<string, ItemDef>> = Object.fromEntries(ITEMS.map((i) => [i.code, i]));

export interface TitleDef {
  code: string;
  name: string;
  source: string;
}

export const TITLES: readonly TitleDef[] = [
  { code: "heir_crowned", name: "Коронованный наследник", source: "Глава 1" },
  { code: "lord_of_court", name: "Хозяин двора", source: "Глава 2" },
  { code: "shadow_breaker", name: "Сокрушитель теней", source: "Глава 3" },
  { code: "tireless", name: "Неутомимый", source: "Достижение «Полсотни дел»" },
  { code: "conqueror", name: "Завоеватель", source: "Достижение «Полководец»" },
  { code: "land_gatherer", name: "Собиратель земель", source: "Достижение «Полкоролевства»" },
  { code: "court_favorite", name: "Любимец двора", source: "Достижение «Душа двора»" },
  { code: "chronicler", name: "Летописец", source: "Достижение «Первая книга»" },
];

export const TITLE_BY_CODE: Readonly<Record<string, TitleDef>> = Object.fromEntries(TITLES.map((t) => [t.code, t]));

export interface AchievementDef {
  code: string;
  name: string;
  icon: string;
  description: string;
  metric: ProgressMetric;
  target: number;
  title?: string;
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { code: "first_quest", name: "Первый шаг", icon: "👣", description: "Выполнить первое реальное задание.", metric: "questsCompleted", target: 1 },
  { code: "quests_10", name: "Десять дел", icon: "📜", description: "Выполнить 10 реальных заданий.", metric: "questsCompleted", target: 10 },
  { code: "quests_50", name: "Полсотни дел", icon: "🏅", description: "Выполнить 50 реальных заданий.", metric: "questsCompleted", target: 50, title: "tireless" },
  { code: "level_3", name: "Растущий правитель", icon: "⭐", description: "Достичь 3 уровня.", metric: "heroLevel", target: 3 },
  { code: "level_5", name: "Опытный правитель", icon: "🌟", description: "Достичь 5 уровня.", metric: "heroLevel", target: 5 },
  { code: "skill_3", name: "Мастер своего дела", icon: "🎓", description: "Развить любой навык до 3 уровня.", metric: "skillLevel", target: 3 },
  { code: "first_building", name: "Первый камень", icon: "🧱", description: "Построить первое здание.", metric: "buildings", target: 1 },
  { code: "builder_5", name: "Зодчий", icon: "🏗️", description: "Завершить 5 построек и улучшений.", metric: "buildings", target: 5 },
  { code: "first_victory", name: "Первая победа", icon: "⚔️", description: "Выиграть первый бой.", metric: "battlesWon", target: 1 },
  { code: "conqueror_5", name: "Полководец", icon: "🛡️", description: "Выиграть 5 боёв.", metric: "battlesWon", target: 5, title: "conqueror" },
  { code: "lands_4", name: "Расширение", icon: "🗺️", description: "Владеть 4 территориями.", metric: "territories", target: 4 },
  { code: "lands_6", name: "Полкоролевства", icon: "🏰", description: "Владеть 6 территориями.", metric: "territories", target: 6, title: "land_gatherer" },
  { code: "army_300", name: "Грозная армия", icon: "🐎", description: "Собрать армию силой 300.", metric: "armyPower", target: 300 },
  { code: "court_friend", name: "Верный друг", icon: "🤝", description: "Подружиться с придворным.", metric: "courtFriends", target: 1 },
  { code: "court_soul", name: "Душа двора", icon: "💐", description: "Подружиться с тремя придворными.", metric: "courtFriends", target: 3, title: "court_favorite" },
  { code: "full_council", name: "Полный совет", icon: "👑", description: "Занять все четыре должности.", metric: "positionsFilled", target: 4 },
  { code: "boss_slayer", name: "Гроза чемпионов", icon: "🐉", description: "Победить двух сюжетных боссов.", metric: "bossesDefeated", target: 2 },
  { code: "book_one", name: "Первая книга", icon: "📖", description: "Пройти все три главы.", metric: "chaptersCompleted", target: 3, title: "chronicler" },
];

export const ACHIEVEMENT_BY_CODE: Readonly<Record<string, AchievementDef>> = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.code, a]));
