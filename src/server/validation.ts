import { z } from "zod";
import { INTERACTIONS, POSITIONS } from "@/data/court/npcs";
import { BUILDING_TYPES } from "@/data/realm/buildings";
import { UNIT_TYPES } from "@/data/realm/units";
import { SKILL_CODES } from "@/data/skills";
import { MAX_DAILY_MINUTES, MIN_DAILY_MINUTES } from "@/engine/quests/planner";
import { isValidTimeZone } from "@/lib/time";

/** Strip control characters and collapse whitespace in short user texts. */
const cleanText = (min: number, max: number) =>
  z
    .string()
    .transform((s) => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim())
    .pipe(z.string().min(min).max(max));

export const startGameSchema = z.object({
  displayName: cleanText(1, 40),
  heroName: cleanText(2, 24),
  kingdomName: cleanText(2, 32),
  timezone: z.string().min(1).max(64).refine(isValidTimeZone, "Неизвестный часовой пояс"),
  dailyMinutes: z.number().int().min(MIN_DAILY_MINUTES).max(MAX_DAILY_MINUTES),
});
export type StartGameInput = z.infer<typeof startGameSchema>;

export const completeQuestSchema = z.object({
  questId: z.string().uuid(),
  idempotencyKey: z.string().min(8).max(100).regex(/^[A-Za-z0-9:_-]+$/),
  note: z.string().max(1000).optional(),
});
export type CompleteQuestInput = z.infer<typeof completeQuestSchema>;

export const skipQuestSchema = z.object({
  questId: z.string().uuid(),
});

export const createQuestSchema = z.object({
  title: cleanText(3, 120),
  description: z.string().max(1000).optional().default(""),
  category: z.enum(SKILL_CODES),
  difficulty: z.number().int().min(1).max(5),
  estimatedMinutes: z.number().int().min(5).max(120),
});
export type CreateQuestInput = z.infer<typeof createQuestSchema>;

export const deleteGameSchema = z.object({
  confirm: z.literal("УДАЛИТЬ"),
});

/** Long free text (answers, chat): keep line breaks, drop other control characters. */
const longText = (min: number, max: number) =>
  z
    .string()
    .transform((s) => s.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").trim())
    .pipe(z.string().min(min).max(max));

export const mentorChatSchema = z.object({
  message: longText(1, 1500),
});

export const evaluateAnswerSchema = z.object({
  questId: z.string().uuid(),
  answer: longText(3, 4000),
  idempotencyKey: z.string().min(8).max(100).regex(/^[A-Za-z0-9:_-]+$/),
});

export const aiSettingsSchema = z.object({
  dailyLimit: z.number().int().min(0).max(200),
  monthlyBudgetUsd: z.number().min(0).max(100),
});

const idempotencyKey = z.string().min(8).max(100).regex(/^[A-Za-z0-9:_-]+$/);
const territoryCode = z.string().regex(/^[a-z_]{2,40}$/);

export const buildSchema = z.object({
  territoryCode,
  buildingType: z.enum(BUILDING_TYPES),
  idempotencyKey,
});

export const recruitSchema = z.object({
  unitType: z.enum(UNIT_TYPES),
  quantity: z.number().int().min(1).max(100),
  idempotencyKey,
});

export const attackSchema = z.object({
  territoryCode,
  tactic: z.enum(["cautious", "balanced", "aggressive"]),
  commander: z.enum(["self", "none", "general"]),
  idempotencyKey,
});

const npcCode = z.string().regex(/^[a-z_]{2,40}$/);

export const courtInteractSchema = z.object({
  npcCode,
  action: z.enum(INTERACTIONS),
  idempotencyKey,
});

export const courtChooseSchema = z.object({
  eventId: z.string().uuid(),
  choice: z.string().regex(/^[a-z0-9_]{1,40}$/),
  idempotencyKey,
});

export const courtAssignSchema = z.object({
  position: z.enum(POSITIONS),
  npcCode: npcCode.nullable(),
  idempotencyKey,
});
