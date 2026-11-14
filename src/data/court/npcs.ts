/**
 * The royal court (ТЗ §12): 5 main characters with personal storylines and 3
 * secondary ones (MVP limit: up to 10). All characters are adults with their
 * own goals and will. Numbers here are starting values; the engine changes them.
 */

export const NPC_STATS = ["loyalty", "affection", "trust", "ambition", "jealousy", "influence"] as const;
export type NpcStat = (typeof NPC_STATS)[number];
export type NpcStats = Record<NpcStat, number>;

export const STAT_LABELS: Readonly<Record<NpcStat, string>> = {
  loyalty: "Лояльность",
  affection: "Симпатия",
  trust: "Доверие",
  ambition: "Амбиции",
  jealousy: "Ревность",
  influence: "Влияние",
};

export type NpcRole = "companion" | "general" | "advisor" | "steward" | "courtier";
export const ROLE_LABELS: Readonly<Record<NpcRole, string>> = {
  companion: "Спутница",
  general: "Полководец",
  advisor: "Советник",
  steward: "Управляющий",
  courtier: "Придворный",
};

export const RELATIONSHIP_STATUSES = ["STRANGERS", "ACQUAINTED", "FRIENDS", "CLOSE", "ROMANCE", "PARTNER", "BROKEN"] as const;
export type RelationshipStatus = (typeof RELATIONSHIP_STATUSES)[number];
export const STATUS_LABELS: Readonly<Record<RelationshipStatus, string>> = {
  STRANGERS: "Незнакомы",
  ACQUAINTED: "Знакомство",
  FRIENDS: "Дружба",
  CLOSE: "Близкие отношения",
  ROMANCE: "Романтические отношения",
  PARTNER: "Постоянная спутница",
  BROKEN: "Разрыв",
};

export const SKILLS = ["martial", "stewardship", "diplomacy", "learning", "intrigue"] as const;
export type NpcSkill = (typeof SKILLS)[number];
export const SKILL_LABELS_NPC: Readonly<Record<NpcSkill, string>> = {
  martial: "Военное дело",
  stewardship: "Хозяйство",
  diplomacy: "Дипломатия",
  learning: "Учёность",
  intrigue: "Интриги",
};

export const POSITIONS = ["commander", "treasurer", "chancellor", "envoy"] as const;
export type Position = (typeof POSITIONS)[number];

export const INTERACTIONS = ["talk", "counsel", "gift", "walk"] as const;
export type Interaction = (typeof INTERACTIONS)[number];

export interface NpcDef {
  code: string;
  name: string;
  age: number;
  role: NpcRole;
  title: string;
  major: boolean;
  romanceable: boolean;
  bio: string;
  goals: string;
  traits: string[];
  likes: Interaction[];
  dislikes: Interaction[];
  skills: Record<NpcSkill, number>;
  start: NpcStats;
  positions: Position[];
  /** Secondary characters join the court when this condition is met (shown to the player). */
  joins?: { kind: "territories"; count: number; text: string } | { kind: "building"; type: "palace" | "academy"; text: string } | { kind: "event"; code: string; text: string };
}

export const NPCS: readonly NpcDef[] = [
  {
    code: "liara",
    name: "Лиара Вейн",
    age: 27,
    role: "companion",
    title: "Посланница Вольных купцов",
    major: true,
    romanceable: true,
    bio: "Дочь капитана из Торгового порта. Приехала ко двору с торговой миссией и осталась: здесь, говорит она, решается судьба всего побережья.",
    goals: "Защитить родной порт от набегов Каэля и добиться для купцов голоса при дворе.",
    traits: ["остроумная", "независимая", "прагматичная"],
    likes: ["counsel", "walk"],
    dislikes: ["gift"],
    skills: { martial: 20, stewardship: 45, diplomacy: 70, learning: 35, intrigue: 50 },
    start: { loyalty: 40, affection: 25, trust: 30, ambition: 65, jealousy: 20, influence: 45 },
    positions: ["envoy", "treasurer"],
  },
  {
    code: "selvina",
    name: "Сельвина Эшгрейв",
    age: 29,
    role: "companion",
    title: "Алхимик Ордена Пепла",
    major: true,
    romanceable: true,
    bio: "Учёная из Старого монастыря. Ушла из Ордена, когда её опыты сочли ересью, и нашла приют в вашей библиотеке.",
    goals: "Закончить главный труд своей жизни и доказать Ордену, что знание не бывает запретным.",
    traits: ["замкнутая", "пытливая", "честная"],
    likes: ["gift", "talk"],
    dislikes: ["counsel"],
    skills: { martial: 10, stewardship: 30, diplomacy: 30, learning: 80, intrigue: 25 },
    start: { loyalty: 45, affection: 20, trust: 25, ambition: 40, jealousy: 30, influence: 30 },
    positions: ["chancellor"],
  },
  {
    code: "torvald",
    name: "Торвальд Грейхельм",
    age: 46,
    role: "general",
    title: "Ветеран северных войн",
    major: true,
    romanceable: false,
    bio: "Служил ещё вашему отцу. Видел, как рушатся королевства, и не прощает слабости, но за своих людей готов идти в огонь.",
    goals: "Чтобы ветераны получили обещанное, а армия снова стала гордостью королевства.",
    traits: ["гордый", "прямой", "верный клятвам"],
    likes: ["counsel"],
    dislikes: ["gift"],
    skills: { martial: 75, stewardship: 35, diplomacy: 25, learning: 30, intrigue: 15 },
    start: { loyalty: 60, affection: 30, trust: 40, ambition: 55, jealousy: 25, influence: 50 },
    positions: ["commander"],
  },
  {
    code: "meyrin",
    name: "Мейрин Олдвуд",
    age: 54,
    role: "advisor",
    title: "Старый советник трона",
    major: true,
    romanceable: false,
    bio: "Пережила трёх правителей и десяток заговоров. Её память длиннее любой летописи, а подозрительность вошла в поговорку.",
    goals: "Удержать королевство от раскола и найти шпиона, который передаёт тайны Каэлю.",
    traits: ["осторожная", "проницательная", "подозрительная"],
    likes: ["counsel", "talk"],
    dislikes: [],
    skills: { martial: 20, stewardship: 50, diplomacy: 55, learning: 65, intrigue: 60 },
    start: { loyalty: 65, affection: 35, trust: 45, ambition: 30, jealousy: 10, influence: 60 },
    positions: ["chancellor", "envoy"],
  },
  {
    code: "bram",
    name: "Брам Голдфинч",
    age: 38,
    role: "steward",
    title: "Управляющий казной",
    major: true,
    romanceable: false,
    bio: "Обаятельный счетовод, который знает цену каждому мешку зерна. Слишком часто улыбается, когда речь заходит о долгах.",
    goals: "Сохранить место и репутацию, а заодно тихо исправить то, что пошло не так.",
    traits: ["обаятельный", "изворотливый", "боится провала"],
    likes: ["gift", "talk"],
    dislikes: ["counsel"],
    skills: { martial: 10, stewardship: 70, diplomacy: 45, learning: 40, intrigue: 45 },
    start: { loyalty: 50, affection: 40, trust: 35, ambition: 50, jealousy: 15, influence: 40 },
    positions: ["treasurer"],
  },
  {
    code: "rein",
    name: "Рейн Сокол",
    age: 33,
    role: "general",
    title: "Капитан молодой гвардии",
    major: false,
    romanceable: false,
    bio: "Быстрый, дерзкий и любимец солдат. Считает, что старые полководцы воюют по картам прошлого века.",
    goals: "Получить командование армией и доказать, что новое время требует новых командиров.",
    traits: ["дерзкий", "смелый", "честолюбивый"],
    likes: ["walk", "counsel"],
    dislikes: [],
    skills: { martial: 62, stewardship: 20, diplomacy: 35, learning: 25, intrigue: 30 },
    start: { loyalty: 45, affection: 30, trust: 30, ambition: 80, jealousy: 35, influence: 25 },
    positions: ["commander"],
    joins: { kind: "territories", count: 3, text: "Присоединится, когда у королевства будет 3 территории." },
  },
  {
    code: "ida",
    name: "Ида Лаурен",
    age: 24,
    role: "courtier",
    title: "Фрейлина и хранительница слухов",
    major: false,
    romanceable: false,
    bio: "Знает всё, что говорят в коридорах дворца, и немного больше. Мечтает однажды сама вести переговоры, а не пересказывать их.",
    goals: "Стать настоящим дипломатом, а не только ушами двора.",
    traits: ["любопытная", "весёлая", "наблюдательная"],
    likes: ["talk", "walk"],
    dislikes: [],
    skills: { martial: 5, stewardship: 25, diplomacy: 50, learning: 35, intrigue: 55 },
    start: { loyalty: 55, affection: 35, trust: 30, ambition: 45, jealousy: 20, influence: 20 },
    positions: ["envoy"],
    joins: { kind: "building", type: "palace", text: "Появится при дворе, когда будет построен дворец." },
  },
  {
    code: "corvin",
    name: "Корвин Тень",
    age: 41,
    role: "courtier",
    title: "Начальник тайной стражи",
    major: false,
    romanceable: false,
    bio: "Молчаливый человек в сером. Его подозревают все, и он к этому привык: такая уж у него служба.",
    goals: "Чтобы правитель доверял ему настолько, чтобы позволить работать без оглядки.",
    traits: ["молчаливый", "расчётливый", "преданный делу"],
    likes: ["counsel"],
    dislikes: ["walk"],
    skills: { martial: 40, stewardship: 25, diplomacy: 30, learning: 40, intrigue: 78 },
    start: { loyalty: 50, affection: 15, trust: 20, ambition: 35, jealousy: 10, influence: 35 },
    positions: ["chancellor"],
    joins: { kind: "event", code: "meyrin_1", text: "Выйдет из тени после первого задания Мейрин." },
  },
];

export const NPC_BY_CODE: Readonly<Record<string, NpcDef>> = Object.fromEntries(NPCS.map((n) => [n.code, n]));
export const isNpcCode = (c: string): boolean => c in NPC_BY_CODE;

/** Starting ties between characters (stored in court_relationships; a < b by code). */
export const STARTING_RELATIONS: readonly { a: string; b: string; type: string; affinity: number; rivalry: number; trust: number }[] = [
  { a: "liara", b: "selvina", type: "rivals", affinity: 30, rivalry: 45, trust: 30 },
  { a: "rein", b: "torvald", type: "rivals", affinity: 25, rivalry: 55, trust: 30 },
  { a: "corvin", b: "meyrin", type: "suspicion", affinity: 20, rivalry: 40, trust: 15 },
  { a: "bram", b: "ida", type: "friends", affinity: 60, rivalry: 5, trust: 55 },
  { a: "bram", b: "liara", type: "allies", affinity: 50, rivalry: 15, trust: 45 },
  { a: "meyrin", b: "torvald", type: "respect", affinity: 55, rivalry: 10, trust: 60 },
  { a: "meyrin", b: "selvina", type: "mentor", affinity: 50, rivalry: 5, trust: 45 },
];

export const POSITION_DEFS: Readonly<Record<Position, { name: string; icon: string; skill: NpcSkill; effect: string }>> = {
  commander: { name: "Командующий армией", icon: "⚔️", skill: "martial", effect: "Может вести армию в бой вместо вас" },
  treasurer: { name: "Казначей", icon: "🪙", skill: "stewardship", effect: "Золото каждый день" },
  chancellor: { name: "Канцлер", icon: "📜", skill: "learning", effect: "Знания каждый день" },
  envoy: { name: "Посол", icon: "🕊️", skill: "diplomacy", effect: "Влияние каждый день" },
};

export const INTERACTION_DEFS: Readonly<Record<Interaction, { name: string; icon: string; description: string; cost?: { gold: number } }>> = {
  talk: { name: "Беседа", icon: "💬", description: "Поговорить о делах и о жизни." },
  counsel: { name: "Совет", icon: "🧭", description: "Спросить мнения по важному вопросу." },
  gift: { name: "Подарок", icon: "🎁", description: "Небольшой знак внимания. Подарки не заменяют доверия.", cost: { gold: 30 } },
  walk: { name: "Прогулка", icon: "🌙", description: "Провести время вдвоём. Доступно с дружбы." },
};

/** Prepared lines when the AI is unavailable (by mood). {hero} is the ruler's name. */
export const FALLBACK_LINES: Readonly<Record<string, { warm: string[]; neutral: string[]; cold: string[] }>> = {
  liara: {
    warm: ["Знаешь, {hero}, в порту говорят, что ты держишь слово. Я начинаю им верить.", "Останься ещё ненадолго. Море подождёт, а вот такие разговоры случаются редко."],
    neutral: ["Купцы считают каждую монету, {hero}. Я считаю каждое обещание.", "Хороший договор — это когда обе стороны немного недовольны."],
    cold: ["У меня мало времени, правитель. Порт ждёт решений, а не слов.", "Вежливость — тоже товар. Сегодня у меня её немного."],
  },
  selvina: {
    warm: ["Я записала твои слова на полях рукописи, {hero}. Надеюсь, ты не против.", "С тобой тишина библиотеки не кажется такой пустой."],
    neutral: ["Каждая формула — это вопрос. Я пока не нашла ответа.", "Орден называл это ересью. Я называю это любопытством."],
    cold: ["Я занята опытом. Если это не срочно, зайди позже.", "Не все двери стоит открывать без стука, правитель."],
  },
  torvald: {
    warm: ["Твой отец гордился бы тобой, {hero}. Я говорю это не часто.", "С таким правителем и старые кости снова хотят в седло."],
    neutral: ["Армия держится на хлебе, стали и доверии. Именно в таком порядке.", "Слова оставь послам. Мне покажи план."],
    cold: ["Ветераны ждут обещанного. Я тоже.", "Я служил трону, когда ты ещё учился ходить. Не забывай об этом."],
  },
  meyrin: {
    warm: ["Ты учишься быстрее, чем я ожидала, {hero}. Это и радует, и пугает.", "Доверие при дворе — редкая монета. Береги ту, что у нас есть."],
    neutral: ["У каждой улыбки при дворе есть цена. Вопрос лишь, кто платит.", "Я помню трёх правителей. Двое из них слишком поздно начали слушать."],
    cold: ["Ты принимаешь решения быстрее, чем обдумываешь. Это опасно.", "Когда-нибудь ты пожалеешь, что не спросил меня раньше."],
  },
  bram: {
    warm: ["Для тебя, {hero}, у меня всегда найдётся честный отчёт. Ну, почти всегда!", "Казна любит тишину, а я люблю, когда ты заходишь."],
    neutral: ["Цифры не лгут, правитель. Лгут люди, которые их пишут. Не я, конечно.", "Урожай, пошлины, жалованье... Всё сходится. В целом."],
    cold: ["Если вы пришли с проверкой, предупредите заранее.", "Я делаю всё возможное, правитель. Не всё в моих силах."],
  },
  rein: {
    warm: ["Дай мне сотню всадников, {hero}, и я принесу тебе победу к ужину.", "С тобой можно говорить прямо. Мне это нравится."],
    neutral: ["Старые полководцы воюют по картам, которым сто лет.", "Солдаты идут за тем, кто идёт впереди."],
    cold: ["Пока Торвальд командует, мне нечего сказать.", "Я жду, когда меня заметят, правитель."],
  },
  ida: {
    warm: ["Хочешь знать, что говорят о тебе в коридорах, {hero}? Только хорошее. Почти.", "Ты единственный, кто слушает меня до конца."],
    neutral: ["Во дворце стены тонкие, а языки длинные.", "Сегодня шепчутся о Каэле. Завтра будут о ком-то ещё."],
    cold: ["Я ничего не слышала. Совсем ничего.", "Фрейлинам не положено иметь мнение, правда?"],
  },
  corvin: {
    warm: ["Вы позволяете мне работать, {hero}. Это лучшая награда.", "У меня есть для вас кое-что. Только для вас."],
    neutral: ["Тени молчат. Это хороший знак. Или очень плохой.", "Каждый при дворе что-то скрывает. Моя работа — знать что."],
    cold: ["Меня снова подозревают. Я привык.", "Доверие работает в обе стороны, правитель."],
  },
};
