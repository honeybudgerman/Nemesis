import { z } from "zod";
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
