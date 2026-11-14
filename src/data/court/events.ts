/**
 * Court events (ТЗ §12.4–12.6, §13.1): personal storylines of the five main
 * characters, intrigues and political events. Each event has a code, opening
 * conditions, participants, text, choices and consequences. The numbers are
 * decided here (the engine), never by the AI.
 */
import type { CourtEventDef, CourtFacts } from "./types";

const npc = (f: CourtFacts, code: string) => f.npcs[code];
const stat = (f: CourtFacts, code: string, s: keyof CourtFacts["npcs"][string]["stats"]) => f.npcs[code]?.stats[s] ?? 0;
const present = (f: CourtFacts, code: string) => !!f.npcs[code]?.recruited;
/** Resolved on an earlier day, so storylines never rush through in one evening. */
const doneBefore = (f: CourtFacts, code: string) => !!f.resolved[code] && f.resolved[code].day < f.day;
const chose = (f: CourtFacts, code: string, ...choices: string[]) => choices.includes(f.resolved[code]?.choice ?? "");
const acquainted = (f: CourtFacts, code: string) => (npc(f, code)?.status ?? "STRANGERS") !== "STRANGERS";
const inRomance = (f: CourtFacts, code: string) => ["ROMANCE", "PARTNER"].includes(npc(f, code)?.status ?? "");
const atLeastClose = (f: CourtFacts, code: string) => ["CLOSE", "ROMANCE", "PARTNER"].includes(npc(f, code)?.status ?? "");
const owned = (f: CourtFacts) => Object.values(f.territories).filter((o) => o === "HERO").length;
const lacks = (f: CourtFacts, cost: Partial<CourtFacts["resources"]>) =>
  (Object.keys(cost) as (keyof CourtFacts["resources"])[]).some((k) => (cost[k] ?? 0) > f.resources[k]) ? "Не хватает ресурсов" : null;

export const COURT_EVENTS: readonly CourtEventDef[] = [
  // -------------------------------------------------------------------------
  // Liara: the port and the alliance
  // -------------------------------------------------------------------------
  {
    code: "liara_1",
    kind: "quest",
    npc: "liara",
    step: 1,
    title: "Пошлины Торгового порта",
    participants: ["liara"],
    text: "Лиара приходит с письмом из дома: корабли Каэля перехватывают торговые суда у Торгового порта. «Мне не нужна армия, {hero}. Мне нужно понять, стоит ли купцам надеяться на этот двор».",
    hint: "Познакомьтесь с Лиарой и завоюйте немного её симпатии или доверия.",
    requires: (f) => present(f, "liara") && acquainted(f, "liara") && (stat(f, "liara", "affection") >= 30 || stat(f, "liara", "trust") >= 35),
    choices: [
      {
        code: "escort",
        label: "Оплатить охрану караванов",
        cost: { gold: 60 },
        unavailable: (f) => lacks(f, { gold: 60 }),
        resolve: () => ({ text: "Лиара долго смотрит на расписку, потом улыбается: «Купцы это запомнят. И я тоже».", npcs: { liara: { affection: 8, trust: 8, loyalty: 5 } }, relations: [{ a: "bram", b: "liara", affinity: 5 }] }),
      },
      {
        code: "promise",
        label: "Пообещать помощь позже",
        resolve: () => ({ text: "«Обещания в порту стоят дёшево», — говорит она, но всё же благодарит.", npcs: { liara: { trust: -3, affection: 2 } } }),
      },
      {
        code: "refuse",
        label: "Это не забота короны",
        resolve: () => ({ text: "Лиара молча складывает письмо. В её взгляде больше нет тепла.", npcs: { liara: { affection: -8, loyalty: -6, trust: -5 } } }),
      },
    ],
  },
  {
    code: "liara_2",
    kind: "quest",
    npc: "liara",
    step: 2,
    title: "Ночь на балконе",
    participants: ["liara"],
    text: "Поздно вечером Лиара признаётся: купцы прислали её оценить вас и решить, стоит ли с вами иметь дело. «Я должна была написать отчёт ещё месяц назад. Я так и не смогла».",
    hint: "Помогите порту и сблизьтесь с Лиарой: нужны симпатия 50 и доверие 45.",
    requires: (f) => doneBefore(f, "liara_1") && chose(f, "liara_1", "escort", "promise") && stat(f, "liara", "affection") >= 50 && stat(f, "liara", "trust") >= 45,
    choices: [
      {
        code: "close",
        label: "Простить и предложить быть рядом",
        hint: "Она решит сама",
        resolve: (f) =>
          stat(f, "liara", "affection") >= 65 && stat(f, "liara", "trust") >= 55
            ? { text: "Лиара берёт вас за руку: «Тогда пусть купцы ждут свой отчёт вечно». Между вами начинается роман.", npcs: { liara: { affection: 10, trust: 6, loyalty: 6 } }, status: { liara: "ROMANCE" } }
            : { text: "«Мне нужно время, {hero}. Я не хочу ошибиться в тебе». Она остаётся другом, но запоминает эту ночь.", npcs: { liara: { affection: 4, trust: 6 } } },
      },
      {
        code: "friends",
        label: "Поблагодарить за честность и остаться друзьями",
        resolve: () => ({ text: "«Друзья при дворе — большая редкость. Спасибо», — тихо отвечает Лиара.", npcs: { liara: { trust: 10, loyalty: 4 } } }),
      },
      {
        code: "expel",
        label: "Отправить её домой",
        resolve: () => ({ text: "Лиара уезжает с первым кораблём, но через неделю возвращается по делам купцов. Холодная и вежливая.", npcs: { liara: { affection: -25, trust: -20, loyalty: -15 } }, status: { liara: "BROKEN" } }),
      },
    ],
  },
  {
    code: "liara_3",
    kind: "quest",
    npc: "liara",
    step: 3,
    title: "Союз с Вольными купцами",
    participants: ["liara", "bram"],
    text: "Совет Вольных купцов готов обсуждать союз. Лиара будет говорить от их имени, но последнее слово за вами.",
    hint: "Завершите разговор на балконе и добейтесь доверия Лиары 60.",
    requires: (f) => doneBefore(f, "liara_2") && !chose(f, "liara_2", "expel") && stat(f, "liara", "trust") >= 60,
    choices: [
      {
        code: "alliance",
        label: "Заключить союз: порт входит в королевство",
        unavailable: (f) => (["NEUTRAL", "FACTION"].includes(f.territories.merchant_port ?? "") ? null : f.territories.merchant_port === "HERO" ? "Порт уже ваш" : "Порт захвачен Каэлем"),
        resolve: (f) => ({
          text:
            inRomance(f, "liara") && stat(f, "liara", "affection") >= 75
              ? "Порт поднимает ваше знамя. Вечером Лиара говорит, что останется с вами не по договору, а по своей воле."
              : "Порт поднимает ваше знамя без единого выстрела. Лиара сдержала слово.",
          territory: "merchant_port",
          resources: { influence: 8 },
          npcs: { liara: { loyalty: 12, influence: 10, trust: 5 } },
          status: inRomance(f, "liara") && stat(f, "liara", "affection") >= 75 ? { liara: "PARTNER" } : undefined,
        }),
      },
      {
        code: "trade",
        label: "Только торговый договор",
        resolve: () => ({ text: "Купцы платят вперёд за спокойные пути. Казна пополняется, порт остаётся свободным.", resources: { gold: 150 }, npcs: { liara: { trust: 5, loyalty: 3 } } }),
      },
    ],
  },

  // -------------------------------------------------------------------------
  // Selvina: the manuscript and the Order
  // -------------------------------------------------------------------------
  {
    code: "selvina_1",
    kind: "quest",
    npc: "selvina",
    step: 1,
    title: "Запретная рукопись",
    participants: ["selvina"],
    text: "Сельвине нужна рукопись из архива Старого монастыря. «Орден не отдаст её просто так. Но без неё мой труд так и останется черновиком».",
    hint: "Познакомьтесь с Сельвиной и завоюйте немного её симпатии или доверия.",
    requires: (f) => present(f, "selvina") && acquainted(f, "selvina") && (stat(f, "selvina", "affection") >= 28 || stat(f, "selvina", "trust") >= 32),
    choices: [
      {
        code: "buy",
        label: "Выкупить рукопись у Ордена",
        cost: { gold: 50 },
        unavailable: (f) => lacks(f, { gold: 50 }),
        resolve: () => ({ text: "Монахи торгуются, но уступают. Сельвина держит рукопись так, будто это живое существо.", npcs: { selvina: { affection: 6, trust: 6, loyalty: 4 } }, resources: { knowledge: 5 } }),
      },
      {
        code: "sneak",
        label: "Помочь ей тайно попасть в архив",
        resolve: () => ({ text: "Ночь, факел, скрип старых полок. Вы возвращаетесь с рукописью и общей тайной.", npcs: { selvina: { affection: 8, trust: 10 }, meyrin: { trust: -4 } }, resources: { knowledge: 5 }, morale: -2 }),
      },
      {
        code: "refuse",
        label: "Не ссориться с Орденом",
        resolve: () => ({ text: "Сельвина кивает и уходит в библиотеку. Дверь за ней закрывается чуть громче обычного.", npcs: { selvina: { affection: -6, trust: -4 }, meyrin: { trust: 3 } } }),
      },
    ],
  },
  {
    code: "selvina_2",
    kind: "quest",
    npc: "selvina",
    step: 2,
    title: "Опыт в лаборатории",
    participants: ["selvina"],
    text: "Опыт идёт не так, лабораторию заполняет дым. Сельвина цела, но руки у неё дрожат. «Я была так близко... Не уходи пока, ладно?»",
    hint: "Добудьте рукопись и сблизьтесь: нужны симпатия 50 и доверие 45.",
    requires: (f) => doneBefore(f, "selvina_1") && chose(f, "selvina_1", "buy", "sneak") && stat(f, "selvina", "affection") >= 50 && stat(f, "selvina", "trust") >= 45,
    choices: [
      {
        code: "stay",
        label: "Остаться с ней до утра",
        hint: "Она решит сама",
        resolve: (f) =>
          stat(f, "selvina", "affection") >= 65 && stat(f, "selvina", "trust") >= 55
            ? { text: "К рассвету формулы забыты. Сельвина смеётся впервые за долгое время, и между вами начинается роман.", npcs: { selvina: { affection: 10, trust: 6, loyalty: 6 } }, status: { selvina: "ROMANCE" } }
            : { text: "Вы разговариваете до утра о звёздах и ошибках. «Спасибо, что не ушёл», — говорит она на прощание.", npcs: { selvina: { affection: 5, trust: 6 } } },
      },
      {
        code: "helpers",
        label: "Назначить ей помощников",
        cost: { gold: 40 },
        unavailable: (f) => lacks(f, { gold: 40 }),
        resolve: () => ({ text: "Двое учеников теперь моют колбы и записывают опыты. Работа идёт быстрее.", npcs: { selvina: { trust: 6, loyalty: 6 } }, resources: { knowledge: 8 } }),
      },
      {
        code: "stop",
        label: "Запретить опасные опыты",
        resolve: () => ({ text: "Сельвина подчиняется, но огонь в её глазах гаснет.", npcs: { selvina: { affection: -10, loyalty: -8, trust: -6 } } }),
      },
    ],
  },
  {
    code: "selvina_3",
    kind: "quest",
    npc: "selvina",
    step: 3,
    title: "Суд Ордена Пепла",
    participants: ["selvina", "meyrin"],
    text: "Орден Пепла требует вернуть Сельвину для суда. Её главный труд почти закончен. Мейрин советует действовать осторожно.",
    hint: "Пройдите опыт в лаборатории и добейтесь доверия Сельвины 60.",
    requires: (f) => doneBefore(f, "selvina_2") && !chose(f, "selvina_2", "stop") && stat(f, "selvina", "trust") >= 60,
    choices: [
      {
        code: "defend",
        label: "Защитить её перед Орденом",
        cost: { influence: 5 },
        unavailable: (f) =>
          lacks(f, { influence: 5 }) ?? (["NEUTRAL", "FACTION"].includes(f.territories.old_monastery ?? "") || f.territories.old_monastery === "HERO" ? null : "Монастырь захвачен Каэлем"),
        resolve: (f) => {
          const joins = ["NEUTRAL", "FACTION"].includes(f.territories.old_monastery ?? "");
          const partner = inRomance(f, "selvina") && stat(f, "selvina", "affection") >= 75;
          return {
            text: `${joins ? "Её труд убеждает даже старейшин: Старый монастырь признаёт вашу власть. " : "Орден отступает. "}${partner ? "Сельвина говорит, что её дом теперь здесь, рядом с вами." : "Сельвина впервые выглядит спокойной."}`,
            territory: joins ? "old_monastery" : undefined,
            npcs: { selvina: { loyalty: 12, trust: 6, influence: 10 }, meyrin: { trust: 3 } },
            resources: { knowledge: 10 },
            status: partner ? { selvina: "PARTNER" } : undefined,
          };
        },
      },
      {
        code: "exchange",
        label: "Договориться об обмене знаниями",
        resolve: () => ({ text: "Орден получает копию труда, а вы — доступ к архивам. Сельвина остаётся при дворе.", resources: { knowledge: 20 }, npcs: { selvina: { trust: 4, loyalty: 3 }, meyrin: { trust: 4 } } }),
      },
    ],
  },

  // -------------------------------------------------------------------------
  // Torvald: veterans and the oath
  // -------------------------------------------------------------------------
  {
    code: "torvald_1",
    kind: "quest",
    npc: "torvald",
    step: 1,
    title: "Старые раны",
    participants: ["torvald"],
    text: "Торвальд приводит к трону троих ветеранов. Им обещали жалованье ещё при вашем отце. «Они не просят милости, {hero}. Они просят долг».",
    hint: "Познакомьтесь с Торвальдом.",
    requires: (f) => present(f, "torvald") && acquainted(f, "torvald"),
    choices: [
      {
        code: "pay",
        label: "Выплатить долг",
        cost: { gold: 80 },
        unavailable: (f) => lacks(f, { gold: 80 }),
        resolve: () => ({ text: "Ветераны кланяются. Торвальд ничего не говорит, но впервые салютует вам по-настоящему.", npcs: { torvald: { loyalty: 10, trust: 8, affection: 4 } }, morale: 5 }),
      },
      {
        code: "land",
        label: "Пообещать им землю после новых побед",
        resolve: () => ({ text: "«Земля — это хорошо. Если она будет», — сухо отвечает Торвальд.", npcs: { torvald: { trust: -2, loyalty: 2 } } }),
      },
      {
        code: "refuse",
        label: "Казна пуста",
        resolve: () => ({ text: "Ветераны уходят. Торвальд провожает их взглядом и долго не смотрит в вашу сторону.", npcs: { torvald: { loyalty: -10, affection: -6 } }, morale: -5 }),
      },
    ],
  },
  {
    code: "torvald_2",
    kind: "quest",
    npc: "torvald",
    step: 2,
    title: "Смотр войск",
    participants: ["torvald", "rein"],
    text: "Торвальд хочет устроить смотр армии, чтобы понять, чего стоят новые солдаты. Капитан Рейн предлагает провести его по-своему.",
    hint: "Решите вопрос с ветеранами и заслужите доверие Торвальда 50.",
    requires: (f) => doneBefore(f, "torvald_1") && stat(f, "torvald", "trust") >= 50,
    choices: [
      {
        code: "self",
        label: "Провести смотр лично",
        resolve: () => ({ text: "Вы проходите вдоль строя под дождём. Солдаты это запомнят, Торвальд тоже.", npcs: { torvald: { trust: 8, loyalty: 4 }, rein: { loyalty: 2 } }, morale: 6 }),
      },
      {
        code: "torvald",
        label: "Поручить Торвальду",
        resolve: () => ({ text: "Старый полководец гоняет солдат до заката. Строй стал ровнее, Рейн недоволен.", npcs: { torvald: { loyalty: 6, influence: 4 }, rein: { loyalty: -4 } }, relations: [{ a: "rein", b: "torvald", rivalry: 8 }], morale: 3 }),
      },
      {
        code: "rein",
        label: "Поручить Рейну",
        unavailable: (f) => (present(f, "rein") ? null : "Рейна пока нет при дворе"),
        resolve: () => ({ text: "Рейн устраивает показательный бой. Солдаты в восторге, Торвальд молча уходит со смотра.", npcs: { torvald: { loyalty: -6, trust: -4 }, rein: { loyalty: 8, influence: 6 } }, relations: [{ a: "rein", b: "torvald", rivalry: 15 }], morale: 4 }),
      },
    ],
  },
  {
    code: "torvald_3",
    kind: "quest",
    npc: "torvald",
    step: 3,
    title: "Клятва полководца",
    participants: ["torvald"],
    text: "Торвальд опускается на одно колено. «Я служил твоему отцу по долгу. Тебе хочу служить по выбору». Он предлагает старую клятву северян.",
    hint: "Пройдите смотр войск и добейтесь лояльности Торвальда 70.",
    requires: (f) => doneBefore(f, "torvald_2") && stat(f, "torvald", "loyalty") >= 70,
    choices: [
      {
        code: "accept",
        label: "Принять клятву",
        resolve: () => ({ text: "Клятва произнесена. Торвальд как командующий теперь ведёт армию с удвоенной решимостью (+10 к военному делу).", npcs: { torvald: { loyalty: 15, trust: 10, influence: 6 } }, morale: 5 }),
      },
      {
        code: "decline",
        label: "Сказать, что его слова достаточно",
        resolve: () => ({ text: "«Скромность — редкое качество для правителя», — Торвальд впервые улыбается.", npcs: { torvald: { trust: 8, affection: 6 } } }),
      },
    ],
  },

  // -------------------------------------------------------------------------
  // Meyrin: the spy
  // -------------------------------------------------------------------------
  {
    code: "meyrin_1",
    kind: "quest",
    npc: "meyrin",
    step: 1,
    title: "Шёпот измены",
    participants: ["meyrin"],
    text: "Мейрин уверена: кто-то при дворе передаёт письма Каэлю. «Я подозреваю человека из тайной стражи. Но подозрение ещё не доказательство, {hero}».",
    hint: "Познакомьтесь с Мейрин.",
    requires: (f) => present(f, "meyrin") && acquainted(f, "meyrin"),
    choices: [
      {
        code: "investigate",
        label: "Начать тихое расследование",
        cost: { gold: 30 },
        unavailable: (f) => lacks(f, { gold: 30 }),
        resolve: () => ({ text: "Мейрин получает людей и полномочия. Через пару дней из тени выходит Корвин и сам предлагает помощь.", npcs: { meyrin: { trust: 6, loyalty: 4 }, corvin: { trust: 4 } } }),
      },
      {
        code: "trust",
        label: "Я доверяю своей страже",
        resolve: () => ({ text: "Мейрин поджимает губы. Корвин, узнав об этом, впервые сам приходит к трону.", npcs: { meyrin: { trust: -6 }, corvin: { loyalty: 8, trust: 6 } }, relations: [{ a: "corvin", b: "meyrin", rivalry: 8 }] }),
      },
      {
        code: "arrest",
        label: "Арестовать начальника стражи",
        resolve: () => ({ text: "Корвина бросают в темницу на три дня и отпускают без улик. Он вернулся к службе, но не забыл.", npcs: { meyrin: { influence: 8 }, corvin: { loyalty: -20, trust: -15, affection: -10 } }, relations: [{ a: "corvin", b: "meyrin", rivalry: 20, trust: -10 }], morale: -3 }),
      },
    ],
  },
  {
    code: "meyrin_2",
    kind: "quest",
    npc: "meyrin",
    step: 2,
    title: "Перехваченное письмо",
    participants: ["meyrin", "bram"],
    text: "Люди Мейрин перехватили письмо. Оно не к Каэлю: это долговая расписка гильдии на имя Брама. «Шпион пока не найден, но у нашей казны тоже есть секреты».",
    hint: "Начните расследование и заслужите доверие Мейрин 55.",
    requires: (f) => doneBefore(f, "meyrin_1") && stat(f, "meyrin", "trust") >= 55,
    choices: [
      {
        code: "public",
        label: "Призвать Брама к ответу при всех",
        resolve: () => ({ text: "Брам бледнеет перед советом. Мейрин довольна, но двор шепчется о жестокости.", npcs: { bram: { loyalty: -10, trust: -6, affection: -6 }, meyrin: { influence: 5, trust: 4 } } }),
      },
      {
        code: "private",
        label: "Поговорить с Брамом наедине",
        resolve: () => ({ text: "Брам благодарит за тайну и обещает всё рассказать. Мейрин считает, что это мудро.", npcs: { bram: { trust: 8, loyalty: 4 }, meyrin: { trust: 5 } } }),
      },
    ],
  },
  {
    code: "meyrin_3",
    kind: "quest",
    npc: "meyrin",
    step: 3,
    title: "Сеть Каэля",
    participants: ["meyrin", "corvin"],
    text: "Вместе с Корвином Мейрин находит настоящего шпиона: писаря при канцелярии. Через него можно передать Каэлю ложные вести или оборвать сеть.",
    hint: "Разберитесь с перехваченным письмом и добейтесь лояльности Мейрин 70.",
    requires: (f) => doneBefore(f, "meyrin_2") && stat(f, "meyrin", "loyalty") >= 70,
    choices: [
      {
        code: "deceive",
        label: "Скормить Каэлю ложные вести",
        resolve: () => ({ text: "Каэль получает письма о мнимом походе на север. Мейрин впервые за годы позволяет себе улыбку.", resources: { influence: 10 }, npcs: { meyrin: { loyalty: 10, influence: 6 }, corvin: { trust: 8, loyalty: 6 } }, relations: [{ a: "corvin", b: "meyrin", rivalry: -15, trust: 15 }] }),
      },
      {
        code: "cut",
        label: "Оборвать сеть и конфисковать золото",
        resolve: () => ({ text: "Шпион схвачен, его тайник найден. Двор спит спокойнее.", resources: { gold: 80 }, morale: 5, npcs: { meyrin: { loyalty: 6, trust: 6 }, corvin: { loyalty: 4 } } }),
      },
    ],
  },

  // -------------------------------------------------------------------------
  // Bram: the hidden debt
  // -------------------------------------------------------------------------
  {
    code: "bram_1",
    kind: "quest",
    npc: "bram",
    step: 1,
    title: "Неровные цифры",
    participants: ["bram"],
    text: "В отчёте казны не сходятся две строки. Брам улыбается слишком широко: «Мелочи, правитель. Ошибка писаря».",
    hint: "Познакомьтесь с Брамом.",
    requires: (f) => present(f, "bram") && acquainted(f, "bram"),
    choices: [
      {
        code: "ask",
        label: "Спросить его прямо",
        hint: "Ответ зависит от доверия",
        resolve: (f) =>
          stat(f, "bram", "trust") >= 40
            ? { text: "Брам вздыхает и признаётся: после неурожая он занял у гильдии, чтобы не тревожить вас.", npcs: { bram: { trust: 8, loyalty: 4 } } }
            : { text: "Брам уверяет, что всё в порядке, и быстро меняет тему. Вы ему не верите.", npcs: { bram: { trust: -3 } } },
      },
      {
        code: "audit",
        label: "Поручить проверку Мейрин",
        resolve: () => ({ text: "Мейрин находит в кладовых забытые сорок золотых и много вопросов к Браму.", resources: { gold: 40 }, npcs: { bram: { loyalty: -6, affection: -4 }, meyrin: { influence: 5 } } }),
      },
      {
        code: "ignore",
        label: "Не придавать значения",
        resolve: () => ({ text: "Брам облегчённо кланяется. Вопросы никуда не делись.", npcs: { bram: { affection: 4 } } }),
      },
    ],
  },
  {
    code: "bram_2",
    kind: "quest",
    npc: "bram",
    step: 2,
    title: "Долг гильдии",
    participants: ["bram"],
    text: "Гильдия требует вернуть заём Брама. «Я виноват, правитель. Скажите, что делать, и я сделаю».",
    hint: "Выясните, что скрывает Брам, и заслужите его доверие 45.",
    requires: (f) => doneBefore(f, "bram_1") && (stat(f, "bram", "trust") >= 45 || chose(f, "meyrin_2", "public", "private")),
    choices: [
      {
        code: "repay",
        label: "Погасить долг из казны",
        cost: { gold: 100 },
        unavailable: (f) => lacks(f, { gold: 100 }),
        resolve: () => ({ text: "Долг закрыт. Брам впервые говорит без улыбки: «Я этого не забуду».", npcs: { bram: { loyalty: 12, trust: 10, affection: 4 } } }),
      },
      {
        code: "work",
        label: "Пусть отработает своим жалованьем",
        resolve: () => ({ text: "Брам соглашается. Месяц он будет работать почти даром, зато честно.", npcs: { bram: { trust: 6, affection: -2, loyalty: 3 } } }),
      },
      {
        code: "dismiss",
        label: "Снять его с должности",
        resolve: () => ({ text: "Брам остаётся при дворе, но без ключей от казны. Он сломлен.", npcs: { bram: { loyalty: -25, affection: -15, influence: -15 } }, dismiss: ["bram"], relations: [{ a: "bram", b: "ida", trust: -5 }] }),
      },
    ],
  },
  {
    code: "bram_3",
    kind: "quest",
    npc: "bram",
    step: 3,
    title: "Новая казна",
    participants: ["bram", "liara"],
    text: "Брам приносит план: честные книги, торговые сборы и запас на неурожай. «Дайте мне шанс сделать это правильно».",
    hint: "Решите вопрос с долгом и добейтесь лояльности Брама 60.",
    requires: (f) => doneBefore(f, "bram_2") && !chose(f, "bram_2", "dismiss") && stat(f, "bram", "loyalty") >= 60,
    choices: [
      {
        code: "reform",
        label: "Принять реформу",
        resolve: () => ({ text: "Казна работает как часы. Брам как казначей теперь приносит вдвое больше золота.", npcs: { bram: { loyalty: 10, trust: 8, influence: 8 }, liara: { trust: 3 } } }),
      },
      {
        code: "small",
        label: "Только небольшие изменения",
        resolve: () => ({ text: "Брам находит, где сэкономить, и приносит первые плоды.", resources: { gold: 60 }, npcs: { bram: { trust: 3 } } }),
      },
    ],
  },

  // -------------------------------------------------------------------------
  // Intrigues
  // -------------------------------------------------------------------------
  {
    code: "jealous_companions",
    kind: "intrigue",
    title: "Две спутницы",
    participants: ["liara", "selvina"],
    text: "На совете Лиара и Сельвина спорят о бюджете: торговые пути или библиотека. Но все понимают, что спор совсем не о золоте.",
    requires: (f) =>
      present(f, "liara") && present(f, "selvina") && atLeastClose(f, "liara") && atLeastClose(f, "selvina") && Math.max(stat(f, "liara", "jealousy"), stat(f, "selvina", "jealousy")) >= 40,
    choices: [
      {
        code: "both",
        label: "Поговорить с обеими честно",
        resolve: () => ({ text: "Разговор тяжёлый, но после него обе дышат свободнее.", npcs: { liara: { jealousy: -15, trust: 5 }, selvina: { jealousy: -15, trust: 5 } }, relations: [{ a: "liara", b: "selvina", rivalry: -10 }] }),
      },
      {
        code: "liara",
        label: "Поддержать Лиару",
        resolve: () => ({ text: "Торговые пути получают деньги. Сельвина молча уходит в библиотеку.", npcs: { liara: { influence: 8, affection: 4 }, selvina: { affection: -12, jealousy: 12, loyalty: -5 } }, relations: [{ a: "liara", b: "selvina", rivalry: 12 }] }),
      },
      {
        code: "selvina",
        label: "Поддержать Сельвину",
        resolve: () => ({ text: "Библиотека получает новое крыло. Лиара холодно поздравляет соперницу.", npcs: { selvina: { influence: 8, affection: 4 }, liara: { affection: -12, jealousy: 12, loyalty: -5 } }, relations: [{ a: "liara", b: "selvina", rivalry: 12 }] }),
      },
    ],
  },
  {
    code: "general_discontent",
    kind: "intrigue",
    title: "Недовольство полководца",
    participants: ["torvald", "rein"],
    text: "Новое назначение командующего раскололо армию: одни солдаты носят цвета Торвальда, другие — Рейна.",
    requires: (f) => present(f, "rein") && (f.npcs.rein?.position === "commander" || f.npcs.torvald?.position === "commander") && stat(f, "rein", "jealousy") + stat(f, "torvald", "jealousy") >= 40,
    choices: [
      {
        code: "share",
        label: "Разделить командование",
        resolve: () => ({ text: "Торвальд ведёт пехоту, Рейн — конницу. Оба недовольны, но армия едина.", npcs: { torvald: { loyalty: 4, jealousy: -10 }, rein: { loyalty: 4, jealousy: -10 } }, relations: [{ a: "rein", b: "torvald", rivalry: -8 }] }),
      },
      {
        code: "exercise",
        label: "Устроить учения между отрядами",
        resolve: () => ({ text: "Учения заканчиваются вничью и общим ужином. Солдаты довольны.", morale: 6, npcs: { torvald: { jealousy: -6 }, rein: { jealousy: -6 } }, relations: [{ a: "rein", b: "torvald", rivalry: -12, affinity: 8 }] }),
      },
      {
        code: "firm",
        label: "Решение принято, споры окончены",
        resolve: (f) => {
          const loser = f.npcs.rein?.position === "commander" ? "torvald" : "rein";
          return { text: "Приказ есть приказ. Проигравший подчиняется, но запоминает.", npcs: { [loser]: { loyalty: -10, jealousy: 10 } }, morale: -2 };
        },
      },
    ],
  },
  {
    code: "court_coalition",
    kind: "intrigue",
    title: "Коалиция недовольных",
    participants: ["meyrin", "bram", "torvald"],
    text: "Несколько придворных собираются по вечерам и говорят о том, что трон их не слышит. Мейрин узнала об этом первой.",
    requires: (f) => Object.values(f.npcs).filter((n) => n.recruited && n.stats.loyalty < 40).length >= 2,
    choices: [
      {
        code: "concede",
        label: "Выслушать их требования",
        cost: { influence: 5 },
        unavailable: (f) => lacks(f, { influence: 5 }),
        resolve: (f) => ({
          text: "Вы садитесь за стол с недовольными. Через час они уже спорят не с вами, а друг с другом. Напряжение спадает.",
          npcs: Object.fromEntries(Object.values(f.npcs).filter((n) => n.recruited && n.stats.loyalty < 40).map((n) => [n.code, { loyalty: 10, trust: 4 }])),
        }),
      },
      {
        code: "break",
        label: "Разогнать коалицию",
        resolve: (f) => ({
          text: "Собрания запрещены. Двор притих, но тишина эта настороженная.",
          npcs: { ...Object.fromEntries(Object.values(f.npcs).filter((n) => n.recruited && n.stats.loyalty < 40).map((n) => [n.code, { loyalty: -5, trust: -6 }])), meyrin: { influence: 5 } },
          morale: -4,
        }),
      },
    ],
  },
  {
    code: "ida_rumors",
    kind: "intrigue",
    title: "Слухи в коридорах",
    participants: ["ida"],
    text: "Ида приносит свежие слухи: кто-то распускает сплетни, что правитель не доживёт до весны. «Я знаю, откуда ветер дует. Хотите услышать?»",
    requires: (f) => present(f, "ida") && acquainted(f, "ida"),
    choices: [
      {
        code: "listen",
        label: "Выслушать",
        resolve: () => ({ text: "Ида рассказывает всё, что знает. Сплетни затихают, а у вас появляется ценный союзник.", npcs: { ida: { loyalty: 6, trust: 8, influence: 5 } }, resources: { influence: 3 } }),
      },
      {
        code: "silence",
        label: "Запретить сплетни при дворе",
        resolve: () => ({ text: "Коридоры притихли. Ида обиженно поджимает губы.", npcs: { ida: { affection: -6, loyalty: -3 } }, morale: 2 }),
      },
    ],
  },

  // -------------------------------------------------------------------------
  // Politics
  // -------------------------------------------------------------------------
  {
    code: "kael_envoy",
    kind: "politics",
    title: "Посол Каэля",
    participants: ["meyrin", "torvald", "liara"],
    text: "Ко двору прибыл посол Чёрного Предела. Он передаёт «дружеский совет» Каэля: не тянуть руки к его границам.",
    requires: (f) => present(f, "meyrin") && Object.keys(f.resolved).length >= 1,
    choices: [
      {
        code: "honor",
        label: "Принять посла с почестями",
        resolve: () => ({ text: "Посол уезжает довольным. Мейрин одобряет, Торвальд хмурится.", resources: { influence: 6 }, npcs: { meyrin: { trust: 4 }, torvald: { loyalty: -3 }, liara: { trust: 2 } } }),
      },
      {
        code: "expel",
        label: "Выставить посла за ворота",
        resolve: () => ({ text: "Солдаты провожают посла свистом. Армия довольна, купцы обеспокоены.", morale: 6, npcs: { torvald: { loyalty: 5, affection: 3 }, liara: { trust: -4 }, meyrin: { trust: -2 } } }),
      },
    ],
  },
  {
    code: "harvest_feast",
    kind: "politics",
    title: "Праздник урожая",
    participants: ["bram", "ida"],
    text: "Урожай собран. Брам предлагает устроить праздник для всего королевства, Ида уже придумала музыку.",
    requires: (f) => owned(f) >= 2 && f.resources.food >= 60,
    choices: [
      {
        code: "feast",
        label: "Устроить праздник",
        cost: { food: 50 },
        unavailable: (f) => lacks(f, { food: 50 }),
        resolve: (f) => ({
          text: "Королевство гуляет три дня. Даже Торвальд танцует, хотя потом будет это отрицать.",
          morale: 10,
          npcs: Object.fromEntries(Object.values(f.npcs).filter((n) => n.recruited).map((n) => [n.code, { loyalty: 3, affection: 2 }])),
        }),
      },
      {
        code: "save",
        label: "Сберечь запасы",
        resolve: () => ({ text: "Амбары полны. Брам одобряет, Ида грустит.", npcs: { bram: { trust: 3 }, ida: { affection: -3 } } }),
      },
    ],
  },
  {
    code: "refugees",
    kind: "politics",
    title: "Беженцы с границы",
    participants: ["selvina", "torvald", "bram"],
    text: "К воротам столицы пришли беженцы с земель, где хозяйничает Каэль. Их больше сотни, и они голодны.",
    requires: (f) => Object.keys(f.resolved).length >= 2,
    choices: [
      {
        code: "shelter",
        label: "Приютить всех",
        cost: { food: 40 },
        unavailable: (f) => lacks(f, { food: 40 }),
        resolve: () => ({ text: "Беженцы получают кров и работу. Народ говорит о милосердии правителя.", resources: { influence: 6 }, npcs: { selvina: { affection: 5, trust: 3 }, torvald: { trust: -2 }, bram: { trust: -2 } } }),
      },
      {
        code: "soldiers",
        label: "Принять только тех, кто готов служить",
        resolve: () => ({ text: "Два десятка крепких мужчин и женщин вступают в ополчение. Остальные уходят дальше.", morale: 3, npcs: { torvald: { loyalty: 4 }, selvina: { affection: -3 } } }),
      },
      {
        code: "turn",
        label: "Закрыть ворота",
        resolve: () => ({ text: "Ворота закрыты. Сельвина долго не может на вас смотреть.", npcs: { selvina: { affection: -8, loyalty: -4 }, bram: { trust: 2 } }, morale: -3 }),
      },
    ],
  },
];

export const EVENT_BY_CODE: Readonly<Record<string, CourtEventDef>> = Object.fromEntries(COURT_EVENTS.map((e) => [e.code, e]));

/** Fixed gameplay flags unlocked by storylines. */
export const FLAGS = {
  torvaldOath: (f: Pick<CourtFacts, "resolved">) => f.resolved.torvald_3?.choice === "accept",
  bramReform: (f: Pick<CourtFacts, "resolved">) => f.resolved.bram_3?.choice === "reform",
};
