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
