import type { SkillCode } from "@/data/skills";

export type RivalOutcome = "SUCCESS" | "PARTIAL" | "FAIL" | "REST";

/**
 * Prepared chronicle lines for Kael's actions. Picked deterministically by the
 * simulator; numbers are filled in from the engine, never invented.
 */
export const ACTION_TITLES: Readonly<Record<SkillCode, string[]>> = {
  english: ["читал донесения на английском", "разбирал речь заморских послов", "учил новые английские выражения"],
  hebrew: ["изучал древние ивритские свитки", "повторял ивритский алфавит", "заучивал фразы на иврите"],
  trading_analysis: ["анализировал торговые пути", "разбирал графики рынка", "изучал прошлые сделки купцов"],
  risk_management: ["пересчитывал риски казны", "составлял правила для казначея", "проверял лимиты потерь"],
  discipline: ["тренировался на рассвете", "провёл сессию сосредоточенной работы", "держал строгий распорядок"],
  time_management: ["планировал неделю", "распределял дела между советниками", "составлял расписание двора"],
};

export const OUTCOME_SUFFIX: Readonly<Record<Exclude<RivalOutcome, "REST">, string[]>> = {
  SUCCESS: [" и справился отлично", " и добился своего", ", не сделав ни одной ошибки"],
  PARTIAL: [", но отвлёкся на полпути", ", но выполнил лишь часть плана", ", но торопился и ошибался"],
  FAIL: [", но потерял нить и бросил", ", но усталость взяла своё", " и провалил задуманное"],
};

export const REST_LINES = [
  "Каэль взял день отдыха и не появлялся в кабинете.",
  "Каэль отменил все дела и уехал на охоту.",
  "Усталость победила: Каэль весь день провёл в покоях.",
];

export const RISK_LOSS_LINES = [
  "Рискованная ставка на караван обернулась потерей {gold} золота.",
  "Поспешная сделка с купцами стоила казне {gold} золота.",
];
