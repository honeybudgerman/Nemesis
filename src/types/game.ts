import type { Grade, LevelProgress } from "@/engine/progression/xp";
import type { EvaluationMode, QuestFrequency } from "@/data/quests/templates";

export type QuestStatus = "PENDING" | "COMPLETED" | "SKIPPED" | "EXPIRED";
export type QuestSource = "TEMPLATE" | "AI" | "MANUAL";

export interface QuestView {
  id: string;
  title: string;
  description: string;
  category: string;
  frequency: QuestFrequency;
  difficulty: number;
  estimatedMinutes: number;
  baseXp: number;
  isOptional: boolean;
  successCriteria: string[];
  status: QuestStatus;
  grade: Grade | null;
  scheduledDate: string;
  deadlineAt: string;
  completedAt: string | null;
  source: QuestSource;
  evaluationMode: EvaluationMode;
}

export interface SkillView {
  code: string;
  level: number;
  xp: number;
  progress: LevelProgress;
}

export interface GameEventView {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface KingdomView {
  name: string;
  gold: number;
  food: number;
  knowledge: number;
  influence: number;
  commandPoints: number;
}

export interface HeroStats {
  wisdom: number;
  willpower: number;
  strategy: number;
  management: number;
  capital: number;
  compassion: number;
}

export interface GameState {
  user: { displayName: string; timezone: string; dailyMinutes: number };
  profile: {
    id: string;
    heroName: string;
    kingdomName: string;
    level: number;
    totalXp: number;
    rank: string;
    currentChapter: number;
    createdAt: string;
    progress: LevelProgress;
  };
  stats: HeroStats;
  skills: SkillView[];
  kingdom: KingdomView;
  quests: { daily: QuestView[]; weekly: QuestView[]; monthly: QuestView[] };
  periods: { today: string; weekStart: string; monthStart: string };
  xp: { today: number; week: number };
  recentEvents: GameEventView[];
  serverTime: string;
}

export interface CompleteQuestResult {
  status: "completed" | "duplicate" | "expired";
  awardedXp: number;
  gold: number;
  knowledge: number;
  leveledUp: boolean;
  level: number;
  state: GameState;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
