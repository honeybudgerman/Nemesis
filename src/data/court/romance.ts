import { addCourtDays } from "./availability";
import type { ChoiceDef, CourtEventDef, CourtFacts } from "./types";

export const ROMANCE_REQUIREMENTS = { affection: 65, trust: 55, reconciliationDays: 7 } as const;

/** Dates are local calendar days supplied by the server, never wall-clock time. */
export function daysSince(day: string, since: string): number {
  return Math.floor((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${since}T00:00:00Z`)) / 86_400_000);
}

export function readyForRomance(f: CourtFacts, code: string): boolean {
  const n = f.npcs[code];
  return !!n?.recruited && n.stats.affection >= ROMANCE_REQUIREMENTS.affection && n.stats.trust >= ROMANCE_REQUIREMENTS.trust
    && !n.brokenSinceDay && n.status !== "BROKEN";
}

export function confessionHint(f: CourtFacts, code: string): string {
  const n = f.npcs[code];
  const progress = `Симпатия ${n?.stats.affection ?? 0}/65, доверие ${n?.stats.trust ?? 0}/55.`;
  if (n?.brokenSinceDay || n?.status === "BROKEN") return `${progress} Сначала нужен отдельный разговор о примирении.`;
  return `${progress} ${readyForRomance(f, code) ? "Готова ответить согласием." : "Пока ей нужно время. Возможность поговорить снова сохранится."} Она решит сама.`;
}

const LINES = [
  { code: "liara", name: "Лиара", confession: "close", title: "Снова на балконе", offer: "Совет купцов предлагает Лиаре капитанство и собственный корабль. Она хочет принять предложение и сохранить ваши отношения.", consent: "Лиара сама берёт вас за руку: «Я больше не хочу прятать свои чувства за отчётами купцам»." },
  { code: "selvina", name: "Юки", confession: "stay", title: "Когда стихнет лаборатория", offer: "Орден предлагает Юки кафедру и амнистию в обмен на возвращение. Она хочет выступить перед учёными и сохранить ваши отношения.", consent: "Юки закрывает рукопись: «Я хочу быть рядом. Теперь я уверена в своём ответе»." },
] as const;

export function reconciliationReady(f: CourtFacts, code: string): boolean {
  const n = f.npcs[code];
  const expelled = code === "liara" && f.resolved.liara_2?.choice === "expel";
  return !!n?.recruited && !expelled && !!n.brokenSinceDay
    && !["ROMANCE", "PARTNER"].includes(n.status)
    && daysSince(f.day, n.brokenSinceDay) >= ROMANCE_REQUIREMENTS.reconciliationDays
    && n.stats.affection >= ROMANCE_REQUIREMENTS.affection && n.stats.trust >= ROMANCE_REQUIREMENTS.trust;
}

const DISMISS_CONVERSATION: ChoiceDef = {
  code: "dismiss", label: "Отложить этот разговор", allowWhenUnavailable: true,
  resolve: () => ({ text: "Вы решаете вернуться к другим делам. Этот разговор завершён без новых обещаний." }),
};

export const CAREER_ABSENCE_DAYS = 3;

export const ROMANCE_EVENTS: readonly CourtEventDef[] = LINES.flatMap(({ code, name, confession, title, consent, offer }): CourtEventDef[] => [
  {
    code: `${code}_second_confession`, kind: "romance", npc: code, title,
    participants: [code], text: `${name} возвращается к вашему прежнему разговору. Теперь вы оба лучше понимаете, чего хотите.`,
    requires: (f) => f.resolved[`${code}_2`]?.choice === confession && f.resolved[`${code}_2`].day < f.day
      && readyForRomance(f, code) && !["ROMANCE", "PARTNER"].includes(f.npcs[code].status),
    choices: [
      { code: "confess", label: "Сказать о чувствах и выслушать её ответ", hint: (f) => confessionHint(f, code),
        resolve: () => ({ text: consent, status: { [code]: "ROMANCE" } }) },
      { code: "friends", label: "Остаться друзьями", resolve: () => ({ text: `${name} принимает ваш выбор. Вы остаётесь друзьями.` }) },
    ],
  },
  {
    code: `${code}_commitment`, kind: "romance", npc: code, title: `${name}: общий дом`,
    participants: [code], text: `${name} хочет обсудить вашу совместную жизнь. Дела королевства не заменят этот разговор.`,
    requires: (f) => !!f.resolved[`${code}_3`] && f.resolved[`${code}_3`].day < f.day
      && f.npcs[code]?.status === "ROMANCE" && f.npcs[code].stats.affection >= 75 && f.npcs[code].stats.trust >= 60,
    choices: [
      { code: "commit", label: "Предложить совместную жизнь", hint: "Она решит сама",
        resolve: () => ({ text: `${name} отвечает согласием: «Я выбираю наш общий дом».`, status: { [code]: "PARTNER" } }) },
      { code: "decline", label: "Сохранить отношения без обязательства", resolve: () => ({ text: `${name} уважает ваше решение не торопить совместную жизнь.` }) },
    ],
  },
  {
    code: `${code}_reconcile`, kind: "romance", npc: code, title: `${name}: второй шанс`,
    participants: [code], text: `После разрыва прошло время. ${name} готова выслушать вас и сама решить, возможно ли начать заново.`,
    requires: (f) => reconciliationReady(f, code),
    choices: [
      { code: "reconcile", label: "Признать ошибки и предложить начать заново", hint: "Она решит сама",
        resolve: () => ({ text: `${name} после долгого разговора соглашается попробовать снова. Доверие предстоит беречь вам обоим.`, status: { [code]: "ROMANCE" } }) },
      { code: "decline", label: "Сохранить дистанцию", resolve: () => ({ text: `${name} принимает ваш осознанный отказ возвращаться к отношениям.` }) },
    ],
  },
  {
    code: `${code}_career_trial`, kind: "romance", npc: code, title: `${name}: своё призвание`,
    participants: [code], text: offer,
    requires: (f) => !!f.npcs[code]?.statusSinceDay && f.npcs[code].status === "ROMANCE" && f.npcs[code].stats.ambition >= 40,
    choices: [
      DISMISS_CONVERSATION,
      { code: "support", label: "Поддержать её карьеру", hint: "Три дня в поездке. Обязанности при дворе выполнят помощники.",
        resolve: (f) => ({ text: `${name} благодарит за доверие и отправляется в трёхдневную поездку. «Я вернусь, и мы обо всём поговорим».`,
          npcs: { [code]: { trust: 6, loyalty: 5, ambition: 5 } }, absentUntil: { [code]: addCourtDays(f.day, CAREER_ABSENCE_DAYS) } }) },
      { code: "stay", label: "Попросить её остаться рядом", hint: "Симпатия вырастет, но ей будет трудно отложить свои планы.",
        resolve: () => ({ text: `${name} решает остаться. Она рада близости, хотя просит впредь обсуждать и её собственные планы.`,
          npcs: { [code]: { affection: 8, loyalty: -3, ambition: 3 } } }) },
    ],
  },
  {
    code: `${code}_partner_evening`, kind: "romance", npc: code, title: `${name}: вечер вдвоём`, cooldownDays: 7,
    participants: [code], text: `${name} предлагает провести вечер вместе и поговорить о том, что занимает вас обоих.`,
    requires: (f) => f.npcs[code]?.status === "PARTNER" && !!f.npcs[code].statusSinceDay,
    choices: [
      DISMISS_CONVERSATION,
      { code: "together", label: "Провести вечер вдвоём", resolve: () => ({ text: "Вы находите время друг для друга. Этот тихий вечер остаётся тёплым общим воспоминанием.", npcs: { [code]: { affection: 3, trust: 2, jealousy: -3 } } }) },
      { code: "talk", label: "Обсудить планы на будущее", resolve: () => ({ text: "Вы долго обсуждаете личные планы и находите место для них в вашей совместной жизни.", npcs: { [code]: { trust: 3, loyalty: 2 } } }) },
    ],
  },
  {
    code: `${code}_partner_anniversary`, kind: "romance", npc: code, title: `${name}: наша годовщина`, cooldownDays: 30,
    participants: [code], text: "Прошёл ещё один месяц вашей совместной жизни. Вы вспоминаете, как решили быть вместе.",
    requires: (f) => f.npcs[code]?.status === "PARTNER" && !!f.npcs[code].statusSinceDay
      && daysSince(f.day, f.npcs[code].statusSinceDay!) >= 30,
    choices: [
      DISMISS_CONVERSATION,
      { code: "celebrate", label: "Отметить годовщину вместе", resolve: () => ({ text: "Вы отмечаете ваш общий день, вспоминаете пройденное и говорите о том, что цените друг в друге.", npcs: { [code]: { affection: 4, trust: 3, loyalty: 2 } } }) },
      { code: "letter", label: "Написать личное письмо", resolve: () => ({ text: `${name} бережно складывает ваше письмо. Ей дорого, что вы помните о вашем общем дне.`, npcs: { [code]: { affection: 3, trust: 4 } } }) },
    ],
  },

]);
