import "server-only";

export type ErrorCode =
  | "UNAUTHORIZED"
  | "VALIDATION_ERROR"
  | "RATE_LIMITED"
  | "PROFILE_NOT_FOUND"
  | "PROFILE_EXISTS"
  | "QUEST_NOT_FOUND"
  | "QUEST_ALREADY_COMPLETED"
  | "QUEST_NOT_PENDING"
  | "QUEST_EXPIRED"
  | "MANUAL_QUEST_LIMIT"
  | "IDEMPOTENCY_KEY_REUSED"
  | "INSUFFICIENT_RESOURCES"
  | "RIVAL_NOT_FOUND"
  | "RIVAL_DAY_GAP"
  | "KINGDOM_NOT_FOUND"
  | "CONSTRUCTION_BUSY"
  | "TERRITORY_NOT_OWNED"
  | "TERRITORY_NOT_ADJACENT"
  | "BUILD_MAX_LEVEL"
  | "BUILD_LEVEL_MISMATCH"
  | "REQUIREMENTS_NOT_MET"
  | "ARMY_FULL"
  | "NO_COMMAND_POINTS"
  | "NOT_ENOUGH_ARMY"
  | "NO_COMMANDER"
  | "ALREADY_INTERACTED"
  | "EVENT_NOT_OPEN"
  | "NPC_NOT_AVAILABLE"
  | "TERRITORY_UNAVAILABLE"
  | "CHOICE_UNAVAILABLE"
  | "STORY_LOCKED"
  | "OBJECTIVES_INCOMPLETE"
  | "BOSS_COOLDOWN"
  | "TITLE_LOCKED"
  | "NOT_CONFIGURED"
  | "INTERNAL";

const STATUS: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401,
  VALIDATION_ERROR: 400,
  RATE_LIMITED: 429,
  PROFILE_NOT_FOUND: 404,
  PROFILE_EXISTS: 409,
  QUEST_NOT_FOUND: 404,
  QUEST_ALREADY_COMPLETED: 409,
  QUEST_NOT_PENDING: 409,
  QUEST_EXPIRED: 409,
  MANUAL_QUEST_LIMIT: 429,
  IDEMPOTENCY_KEY_REUSED: 409,
  INSUFFICIENT_RESOURCES: 409,
  RIVAL_NOT_FOUND: 404,
  RIVAL_DAY_GAP: 409,
  KINGDOM_NOT_FOUND: 404,
  CONSTRUCTION_BUSY: 409,
  TERRITORY_NOT_OWNED: 409,
  TERRITORY_NOT_ADJACENT: 409,
  BUILD_MAX_LEVEL: 409,
  BUILD_LEVEL_MISMATCH: 409,
  REQUIREMENTS_NOT_MET: 409,
  ARMY_FULL: 409,
  NO_COMMAND_POINTS: 409,
  NOT_ENOUGH_ARMY: 409,
  NO_COMMANDER: 409,
  ALREADY_INTERACTED: 409,
  EVENT_NOT_OPEN: 409,
  NPC_NOT_AVAILABLE: 409,
  TERRITORY_UNAVAILABLE: 409,
  CHOICE_UNAVAILABLE: 409,
  STORY_LOCKED: 409,
  OBJECTIVES_INCOMPLETE: 409,
  BOSS_COOLDOWN: 409,
  TITLE_LOCKED: 409,
  NOT_CONFIGURED: 503,
  INTERNAL: 500,
};

const MESSAGES: Record<ErrorCode, string> = {
  UNAUTHORIZED: "Нужно войти в аккаунт.",
  VALIDATION_ERROR: "Некорректные данные запроса.",
  RATE_LIMITED: "Слишком много запросов. Подождите немного.",
  PROFILE_NOT_FOUND: "Герой ещё не создан.",
  PROFILE_EXISTS: "Герой уже создан.",
  QUEST_NOT_FOUND: "Задание не найдено.",
  QUEST_ALREADY_COMPLETED: "Это задание уже выполнено.",
  QUEST_NOT_PENDING: "Задание уже закрыто.",
  QUEST_EXPIRED: "Срок задания истёк.",
  MANUAL_QUEST_LIMIT: "Лимит собственных заданий на сегодня исчерпан.",
  IDEMPOTENCY_KEY_REUSED: "Повторный запрос с чужим ключом.",
  INSUFFICIENT_RESOURCES: "Недостаточно ресурсов.",
  RIVAL_NOT_FOUND: "Соперник ещё не появился.",
  RIVAL_DAY_GAP: "Хроника соперника рассинхронизирована, повторите запрос.",
  KINGDOM_NOT_FOUND: "Королевство ещё не основано.",
  CONSTRUCTION_BUSY: "Уже идёт строительство. Дождитесь его окончания.",
  TERRITORY_NOT_OWNED: "Эта территория вам не принадлежит.",
  TERRITORY_NOT_ADJACENT: "Атаковать можно только соседние территории.",
  BUILD_MAX_LEVEL: "Достигнут максимальный уровень: сначала улучшите замок.",
  BUILD_LEVEL_MISMATCH: "Постройка уже изменилась. Обновите экран.",
  REQUIREMENTS_NOT_MET: "Не выполнены требования для найма.",
  ARMY_FULL: "Армия заполнена. Улучшите замок или казармы.",
  NO_COMMAND_POINTS: "Нет очков командования. Они восстанавливаются каждый день.",
  NOT_ENOUGH_ARMY: "Некого вести в бой: наймите войска.",
  NO_COMMANDER: "Командующий не назначен или не готов вести армию.",
  ALREADY_INTERACTED: "Сегодня вы уже уделили время этому персонажу.",
  EVENT_NOT_OPEN: "Это событие уже решено.",
  NPC_NOT_AVAILABLE: "Этого персонажа пока нет при дворе.",
  TERRITORY_UNAVAILABLE: "Эта территория сейчас недоступна.",
  CHOICE_UNAVAILABLE: "Этот вариант сейчас недоступен.",
  STORY_LOCKED: "Этот шаг сюжета пока недоступен.",
  OBJECTIVES_INCOMPLETE: "Цели главы ещё не выполнены.",
  BOSS_COOLDOWN: "Сегодня армия уже штурмовала. Новая попытка — завтра.",
  TITLE_LOCKED: "Этот титул ещё не получен.",
  NOT_CONFIGURED: "Сервер не настроен: не заданы ключи Supabase.",
  INTERNAL: "Внутренняя ошибка сервера.",
};

export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message?: string,
    public readonly details?: unknown,
  ) {
    super(message ?? MESSAGES[code]);
  }
  get status(): number {
    return STATUS[this.code];
  }
}

/** Translate a Postgres `raise exception 'CODE'` coming back through PostgREST. */
export function fromDbError(err: { message?: string } | null | undefined): ApiError {
  const msg = err?.message ?? "";
  const code = (Object.keys(STATUS) as ErrorCode[]).find((c) => msg.includes(c));
  return code ? new ApiError(code) : new ApiError("INTERNAL");
}
