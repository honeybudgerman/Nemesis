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
  /** Kael's summary; null only if the rival tables are not migrated yet. */
  rival: RivalSummary | null;
  serverTime: string;
}

export interface RivalActionView {
  id: string;
  day: string;
  index: number;
  type: "STUDY" | "REST";
  category: string | null;
  minutes: number;
  outcome: "SUCCESS" | "PARTIAL" | "FAIL" | "REST";
  grade: string | null;
  xp: number;
  gold: number;
  text: string;
}

export interface RivalSummary {
  name: string;
  level: number;
  totalXp: number;
  progress: LevelProgress;
  weekXp: number;
  lastSimulatedDay: string;
  /** Finished days not yet simulated (client keeps calling /api/rival/sync while > 0). */
  pendingDays: number;
  lastAction: RivalActionView | null;
}

export interface RivalView extends RivalSummary {
  stats: HeroStats;
  skills: (SkillView & { heroLevel: number })[];
  kingdom: KingdomView;
  actions: RivalActionView[];
  hero: { level: number; totalXp: number; weekXp: number };
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

export interface AiStatus {
  configured: boolean;
  model: string;
  todayRequests: number;
  dailyLimit: number;
  monthCostUsd: number;
  monthlyBudgetUsd: number;
}

export interface MentorMessageView {
  id: string;
  role: "user" | "mentor";
  content: string;
  source: "USER" | "AI" | "FALLBACK";
  createdAt: string;
}

export interface MentorEvaluationView {
  id: string;
  questId: string;
  questTitle: string;
  grade: Grade;
  reasoning: string;
  mistakes: string[];
  recommendations: string[];
  nextTopic: string;
  createdAt: string;
}

export interface MentorView {
  heroName: string;
  ai: AiStatus;
  planToday: "available" | "exists" | "too_late";
  reviewQuests: { id: string; title: string }[];
  messages: MentorMessageView[];
  evaluations: MentorEvaluationView[];
}
