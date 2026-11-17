/**
 * Story (ТЗ §13): three chapters of the first book. The story state lives in
 * the database (story_progress); the text lives here. Each chapter: an intro
 * scene, objectives taken from real game progress, one decision, an optional
 * boss, and an outro scene with rewards.
 */
import type { Terrain, TerritoryResource } from "@/data/realm/map";
import type { ProgressMetric } from "./progress";

export type Speaker = "narrator" | "hero" | "mentor" | "rival" | "liara" | "selvina" | "torvald" | "meyrin" | "bram" | "bandit" | "morven";
export type Backdrop = "throne" | "village" | "hall" | "night" | "border" | "forest";

export interface DialogueLine {
  speaker: Speaker;
  text: string;
}

export interface SceneDef {
  code: string;
  title: string;
  backdrop: Backdrop;
  lines: DialogueLine[];
}

export const FIRST_QUESTS_SCENE: SceneDef = {
  code: "ch1_first_quests",
  title: "Открытые ворота",
  backdrop: "throne",
  lines: [
    { speaker: "mentor", text: "Я видел, как ты держишь слово, {hero}. Три дела доведены до конца. У ворот уже ждёт посланник из деревни." },
    { speaker: "hero", text: "Открой ворота, Орион. Пусть расскажет, чем мы можем помочь." },
    { speaker: "mentor", text: "Выслушай его. Потом решишь, что обещать деревне и что королевство может дать." },
  ],
};

export interface ObjectiveDef {
  code: string;
  label: string;
  metric: ProgressMetric;
  target: number;
}

export type StoryWallet = Partial<Record<"gold" | "food" | "knowledge" | "influence", number>>;

export interface StoryChoiceDef {
  code: string;
  label: string;
  /** Spent when chosen (must be affordable). */
  cost?: StoryWallet;
  /** Gained when chosen. */
  gain?: StoryWallet;
  morale?: number;
  text: string;
}

export interface DecisionDef {
  code: string;
  title: string;
  backdrop: Backdrop;
  text: string;
  choices: StoryChoiceDef[];
}

export interface BossDef {
  code: string;
  name: string;
  title: string;
  speaker: Speaker;
  backdrop: Backdrop;
  text: string;
  defender: "NEUTRAL" | "RIVAL";
  target: { terrain: Terrain; garrison: number; fortification: number; resource: TerritoryResource };
  rewards: StoryWallet;
  item?: string;
  victory: string;
  defeat: string;
}

export interface ChapterDef {
  code: string;
  number: number;
  title: string;
  summary: string;
  intro: SceneDef;
  objectives: ObjectiveDef[];
  decision: DecisionDef;
  boss?: BossDef;
  outro: SceneDef;
  rewards: { resources: StoryWallet; items: string[]; titles: string[] };
  /** Fallback chronicle when the AI chronicler is unavailable. */
  chronicle: string;
}

export const CHAPTERS: readonly ChapterDef[] = [
  {
    code: "ch1",
    number: 1,
    title: "Два наследника",
    summary: "Обучение, первые задания, восстановление деревни и первый бой.",
    intro: {
      code: "ch1_intro",
      title: "Последняя воля",
      backdrop: "throne",
      lines: [
        { speaker: "narrator", text: "Старый король умер на рассвете. Его последняя воля разделила королевство надвое." },
        { speaker: "mentor", text: "{hero}, я Орион. Твой отец просил меня быть рядом, когда этот день настанет." },
        { speaker: "hero", text: "Надвое? Кому досталась вторая половина?" },
        { speaker: "mentor", text: "Каэлю Валькариону, твоему кузену. Он уже поднял знамя над Чёрным Пределом." },
        { speaker: "rival", text: "Половина королевства — неплохое начало. Посмотрим, кто первым заберёт вторую, кузен." },
        { speaker: "mentor", text: "Каэль не ждёт и не спит. Но сила правителя рождается не в замке, а в его делах. Каждое настоящее усилие укрепит твоё королевство." },
        { speaker: "narrator", text: "Глава 1. Два наследника." },
      ],
    },
    objectives: [
      { code: "quests", label: "Выполнить 3 реальных задания", metric: "questsCompleted", target: 3 },
      { code: "build", label: "Построить первое здание", metric: "buildings", target: 1 },
      { code: "battle", label: "Выиграть первый бой на карте", metric: "battlesWon", target: 1 },
    ],
    decision: {
      code: "ch1_village",
      title: "Сожжённая деревня",
      backdrop: "village",
      text: "Разбойники сожгли деревню у Речных бродов. Жители просят помощи до наступления зимы.",
      choices: [
        { code: "grain", label: "Отдать зерно из амбаров", cost: { food: 40 }, morale: 5, text: "Амбары пустеют, но деревня оживает. Люди запомнят щедрость правителя." },
        { code: "workers", label: "Нанять плотников", cost: { gold: 60 }, gain: { influence: 3 }, text: "За неделю плотники ставят новые дома. Деревня встречает зиму под крышами." },
        { code: "later", label: "Пообещать помощь позже", morale: -3, text: "Жители расходятся молча. Обещания греют хуже очага." },
      ],
    },
    boss: {
      code: "bandit_chief",
      name: "Грыз Однорукий",
      title: "Атаман лесных разбойников",
      speaker: "bandit",
      backdrop: "forest",
      text: "Банда, сжёгшая деревню, засела в Шепчущем лесу. Пока её атаман жив, дороги не будут безопасны.",
      defender: "NEUTRAL",
      target: { terrain: "forest", garrison: 40, fortification: 1, resource: "gold" },
      rewards: { gold: 80, food: 30 },
      item: "bandit_banner",
      victory: "Банда рассеяна, Грыз бежит в чащу, бросив знамя. Дороги снова безопасны.",
      defeat: "Разбойники знают лес лучше ваших солдат. Отряд отступает, но атаман ещё попадётся.",
    },
    outro: {
      code: "ch1_outro",
      title: "Письмо с чёрной печатью",
      backdrop: "village",
      lines: [
        { speaker: "narrator", text: "Разбойники рассеяны, деревня отстраивается." },
        { speaker: "mentor", text: "Ты сделал первый шаг, {hero}. Но корона тяжелее, чем кажется." },
        { speaker: "narrator", text: "В тот же вечер гонец привёз письмо с чёрной печатью." },
        { speaker: "rival", text: "Поздравляю с первой победой, кузен. Разбойники — достойные противники для начала." },
        { speaker: "hero", text: "Он следит за мной." },
        { speaker: "mentor", text: "Он следит за всеми. Теперь пора навести порядок при дворе." },
      ],
    },
    rewards: { resources: { gold: 100 }, items: ["father_seal"], titles: ["heir_crowned"] },
    chronicle: "Наследник принял корону в день, когда королевство раскололось надвое. Первые дела правителя укрепили его земли, деревня у Речных бродов поднялась из пепла, а лесные разбойники узнали силу новой власти.",
  },
  {
    code: "ch2",
    number: 2,
    title: "Цена власти",
    summary: "Придворная жизнь, первые интриги и новые территории.",
    intro: {
      code: "ch2_intro",
      title: "Паутина двора",
      backdrop: "hall",
      lines: [
        { speaker: "narrator", text: "Слухи о победе разошлись по королевству, и ко двору потянулись люди." },
        { speaker: "meyrin", text: "Правитель, двор — это не зал с колоннами. Это паутина. Каждый здесь чего-то хочет." },
        { speaker: "liara", text: "А некоторые просто хотят, чтобы их выслушали. Торговый порт, например." },
        { speaker: "torvald", text: "Армии нужно жалованье, а не речи." },
        { speaker: "mentor", text: "Слушай их всех, {hero}, но решай сам. Доверие при дворе строится медленно, а рушится за один вечер." },
        { speaker: "narrator", text: "Глава 2. Цена власти." },
      ],
    },
    objectives: [
      { code: "friend", label: "Подружиться с одним из придворных", metric: "courtFriends", target: 1 },
      { code: "events", label: "Принять 2 решения при дворе", metric: "courtEventsResolved", target: 2 },
      { code: "lands", label: "Владеть 3 территориями", metric: "territories", target: 3 },
      { code: "office", label: "Назначить придворного на должность", metric: "positionsFilled", target: 1 },
    ],
    decision: {
      code: "ch2_taxes",
      title: "Совет о налогах",
      backdrop: "hall",
      text: "Казна пустеет быстрее, чем наполняется. Брам предлагает поднять налоги, Мейрин предупреждает о недовольстве.",
      choices: [
        { code: "raise", label: "Поднять налоги", gain: { gold: 120 }, morale: -6, text: "Сундуки полнеют, но в тавернах ворчат." },
        { code: "merchants", label: "Обложить пошлиной только купцов", gain: { gold: 70 }, cost: { influence: 3 }, text: "Купцы недовольны, но платят. Народ этого почти не замечает." },
        { code: "keep", label: "Оставить налоги как есть", gain: { influence: 6 }, morale: 4, text: "Народ благодарен. Брам вздыхает и переписывает бюджет." },
      ],
    },
    outro: {
      code: "ch2_outro",
      title: "Тень над заставой",
      backdrop: "night",
      lines: [
        { speaker: "narrator", text: "Двор живёт своей жизнью: союзы, обиды, шёпот в коридорах." },
        { speaker: "meyrin", text: "Вы справляетесь лучше, чем я ожидала. Но есть новость хуже прочих." },
        { speaker: "meyrin", text: "Каэль собирает войска у Чёрной заставы. Его чемпион, Морвен, уже ищет повод для войны." },
        { speaker: "mentor", text: "Тень соперника становится длиннее. Готовься, {hero}." },
      ],
    },
    rewards: { resources: { influence: 10 }, items: ["ledger_book"], titles: ["lord_of_court"] },
    chronicle: "Ко двору потянулись купцы, учёные и воины. Правитель научился слушать и решать, раздал первые должности и расширил границы, а над Чёрной заставой тем временем сгущались тучи.",
  },
  {
    code: "ch3",
    number: 3,
    title: "Тень соперника",
    summary: "Первое серьёзное столкновение с Каэлем, дипломатия и сюжетный босс.",
    intro: {
      code: "ch3_intro",
      title: "Вызов на перевале",
      backdrop: "border",
      lines: [
        { speaker: "narrator", text: "Над Чёрной заставой развевается знамя Валькарионов." },
        { speaker: "rival", text: "Ты вырос, кузен. Двор, земли, армия... Почти как настоящий король." },
        { speaker: "hero", text: "Чего ты хочешь, Каэль?" },
        { speaker: "rival", text: "Чтобы ты увидел разницу между нами. Мой чемпион ждёт тебя на перевале. Победишь — поговорим как равные." },
        { speaker: "torvald", text: "Морвен — опасный противник. Не веди людей на убой, правитель. Сначала укрепи армию." },
        { speaker: "mentor", text: "Это испытание не только силы, но и терпения. Готовься столько, сколько нужно." },
        { speaker: "narrator", text: "Глава 3. Тень соперника." },
      ],
    },
    objectives: [
      { code: "level", label: "Достичь 4 уровня", metric: "heroLevel", target: 4 },
      { code: "army", label: "Собрать армию силой 250", metric: "armyPower", target: 250 },
      { code: "lands", label: "Владеть 4 территориями", metric: "territories", target: 4 },
    ],
    decision: {
      code: "ch3_answer",
      title: "Ответ Каэлю",
      backdrop: "border",
      text: "Посланник Каэля ждёт ответа. От ваших слов зависит, каким будет этот поединок.",
      choices: [
        { code: "honor", label: "Принять вызов с честью", gain: { influence: 5 }, text: "Вы отвечаете учтиво. Даже враги признают: правитель держит лицо." },
        { code: "envoys", label: "Отправить послов к соседям", cost: { gold: 50 }, morale: 4, text: "Соседи обещают не вмешиваться. Каэль остаётся без союзников." },
        { code: "defiance", label: "Ответить дерзко", morale: 8, cost: { influence: 3 }, text: "Солдаты смеются над письмом Каэля. Боевой дух высок, дипломаты хмурятся." },
      ],
    },
    boss: {
      code: "morven",
      name: "Морвен",
      title: "Чёрный Страж, чемпион Каэля",
      speaker: "morven",
      backdrop: "border",
      text: "На узком перевале Морвен ждёт со своей гвардией. Здесь не помогут хитрость и слова: только сила и выучка армии.",
      defender: "RIVAL",
      target: { terrain: "mountains", garrison: 110, fortification: 2, resource: "influence" },
      rewards: { gold: 200, influence: 10 },
      victory: "Строй Чёрной гвардии ломается. Морвен опускает меч: поединок окончен.",
      defeat: "Гвардия Морвена держит перевал. Армия отходит, чтобы собраться с силами.",
    },
    outro: {
      code: "ch3_outro",
      title: "Первая партия",
      backdrop: "border",
      lines: [
        { speaker: "narrator", text: "Морвен преклоняет колено. Его меч лежит у ваших ног." },
        { speaker: "rival", text: "Неплохо, кузен. Очень неплохо." },
        { speaker: "rival", text: "Но это была лишь первая партия. Королевство всё ещё разделено, и я не собираюсь проигрывать." },
        { speaker: "mentor", text: "Ты прошёл первые испытания, {hero}. Настоящая игра только начинается — и в жизни, и здесь." },
        { speaker: "narrator", text: "Конец первой книги. Продолжение следует." },
      ],
    },
    rewards: { resources: { gold: 150 }, items: ["dawn_blade"], titles: ["shadow_breaker"] },
    chronicle: "Каэль бросил вызов, и правитель принял его. На перевале у Чёрной заставы армия королевства сломила гвардию Морвена. Первая книга закрыта, но соперничество двух наследников только начинается.",
  },
];

export const CHAPTER_BY_CODE: Readonly<Record<string, ChapterDef>> = Object.fromEntries(CHAPTERS.map((c) => [c.code, c]));

export const SPEAKERS: Readonly<Record<Speaker, { name: string }>> = {
  narrator: { name: "Летописец" },
  hero: { name: "{hero}" },
  mentor: { name: "Орион" },
  rival: { name: "Каэль" },
  liara: { name: "Лиара" },
  selvina: { name: "Юки" },
  torvald: { name: "Торвальд" },
  meyrin: { name: "Мейрин" },
  bram: { name: "Брам" },
  bandit: { name: "Грыз Однорукий" },
  morven: { name: "Морвен" },
};
