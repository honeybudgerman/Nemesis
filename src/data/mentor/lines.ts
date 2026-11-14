import { hashString } from "@/lib/random";

/**
 * Prepared Orion lines used until the AI mentor arrives (Sprint 3) and as a
 * fallback whenever AI is unavailable (ТЗ §9.4). They never invent progress:
 * every line is chosen from the real state passed in.
 */
interface MentorContext {
  heroName: string;
  date: string;
  mainTotal: number;
  mainDone: number;
  anyDoneToday: boolean;
}

const MORNING = [
  "{hero}, путь к свободе строится из малых шагов. Начни с самого простого задания.",
  "Не ищи идеального дня, {hero}. Ищи следующий честный шаг.",
  "Дисциплина — это обещание, данное себе. Сегодня у тебя три таких обещания.",
  "Рынок вознаграждает терпение, а не спешку. Так же и учёба.",
  "Сила воли растёт от повторения, а не от рывков. Один шаг — уже победа.",
];

const PROGRESS = [
  "Хорошее начало, {hero}. Осталось {left}. Не торопись — делай качественно.",
  "Ты уже в пути. Ещё {left}, и день будет завершён.",
  "Каждое выполненное задание укрепляет королевство. Осталось {left}.",
];

const DONE = [
  "Все основные задания выполнены. Отдохни, {hero} — отдых тоже часть стратегии.",
  "Сегодняшний долг исполнен. Королевство помнит твой труд.",
  "Прекрасная работа. Завтра продолжим, а сейчас восстанови силы.",
];

const pluralTasks = (n: number) => (n === 1 ? "1 задание" : n >= 2 && n <= 4 ? `${n} задания` : `${n} заданий`);

export function mentorLine(ctx: MentorContext): string {
  const seed = hashString(`${ctx.date}:${ctx.mainDone}`);
  const left = ctx.mainTotal - ctx.mainDone;
  const pool = left <= 0 && ctx.mainTotal > 0 ? DONE : ctx.anyDoneToday ? PROGRESS : MORNING;
  return pool[seed % pool.length].replaceAll("{hero}", ctx.heroName).replaceAll("{left}", pluralTasks(Math.max(0, left)));
}
