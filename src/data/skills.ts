export const SKILL_CODES = [
  "english",
  "hebrew",
  "trading_analysis",
  "risk_management",
  "discipline",
  "time_management",
] as const;

export type SkillCode = (typeof SKILL_CODES)[number];

export const SKILL_LABELS: Readonly<Record<SkillCode, string>> = {
  english: "Английский",
  hebrew: "Иврит",
  trading_analysis: "Анализ трейдинга",
  risk_management: "Риск-менеджмент",
  discipline: "Дисциплина",
  time_management: "Управление временем",
};

export const SKILL_ICONS: Readonly<Record<SkillCode, string>> = {
  english: "📜",
  hebrew: "🕎",
  trading_analysis: "📈",
  risk_management: "🛡️",
  discipline: "⚔️",
  time_management: "⏳",
};

export function isSkillCode(value: string): value is SkillCode {
  return (SKILL_CODES as readonly string[]).includes(value);
}
