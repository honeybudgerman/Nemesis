import type { Backdrop, Speaker } from "@/data/story/chapters";
import type { ChapterStage, ObjectiveState } from "@/engine/story/story";
import type { Army, BattleInput, RiskEstimate } from "@/engine/realm/battle";
import type { Tactic } from "@/data/realm/units";

export interface SceneView {
  code: string;
  title: string;
  backdrop: Backdrop;
  lines: { speaker: Speaker; name: string; text: string }[];
}

export interface StoryChoiceView {
  code: string;
  label: string;
  effects: string[];
  blocked: string | null;
}

export interface BossView {
  code: string;
  name: string;
  title: string;
  text: string;
  backdrop: Backdrop;
  speaker: Speaker;
  defeated: boolean;
  attempts: number;
  blocked: string | null;
  risk: RiskEstimate;
  target: BattleInput["target"];
  rewards: string[];
  item: { name: string; icon: string } | null;
}

export interface ChapterView {
  code: string;
  number: number;
  title: string;
  summary: string;
  stage: ChapterStage;
  objectives: ObjectiveState[];
  decision: {
    title: string;
    text: string;
    backdrop: Backdrop;
    choices: StoryChoiceView[];
    chosen: { label: string; text: string } | null;
  };
  boss: BossView | null;
  intro: SceneView;
  outro: SceneView;
  rewards: string[];
}

export interface ChapterSummary {
  code: string;
  number: number;
  title: string;
  summary: string;
  status: "locked" | "active" | "completed";
  decision: string | null;
  chronicle: string | null;
  chronicleSource: "AI" | "FALLBACK" | null;
  completedAt: string | null;
  outroSeen: boolean;
  /** Scenes to replay (only for unlocked chapters). */
  intro: SceneView | null;
  outro: SceneView | null;
}

export interface AchievementView {
  code: string;
  name: string;
  icon: string;
  description: string;
  unlocked: boolean;
  unlockedAt: string | null;
  progress: { current: number; target: number };
  title: string | null;
}

export interface TitleView {
  code: string;
  name: string;
  source: string;
  unlocked: boolean;
  active: boolean;
}

export interface ItemView {
  code: string;
  name: string;
  icon: string;
  description: string;
  effect: string;
  owned: boolean;
}

export type TimelineCategory = "kingdom" | "battles" | "politics" | "rivalry" | "story";

export interface TimelineItem {
  id: string;
  type: string;
  category: TimelineCategory;
  text: string;
  at: string;
}

export interface StoryScreen {
  heroName: string;
  today: string;
  activeTitle: { code: string; name: string } | null;
  current: ChapterView | null;
  /** A scene the player has not watched yet. */
  pendingScene: { chapter: string; scene: "intro" | "outro" } | null;
  chapters: ChapterSummary[];
  achievements: AchievementView[];
  /** Achievements unlocked by this very request. */
  newAchievements: string[];
  titles: TitleView[];
  items: ItemView[];
  timeline: TimelineItem[];
  army: { units: Army; power: number; morale: number; commandPoints: number };
  heroStrategy: number;
  general: { code: string; name: string; skill: number } | null;
  powerBonus: number;
}

export interface BossOutcome {
  status: "resolved" | "duplicate";
  battle: {
    win: boolean;
    name: string;
    text: string;
    tactic: Tactic;
    attackerPower: number;
    defenderPower: number;
    casualties: Army;
    rewards: string[];
  } | null;
  screen: StoryScreen;
}

export interface DecisionOutcome {
  status: "applied" | "duplicate";
  outcome: { title: string; choice: string; text: string; effects: string[] } | null;
  screen: StoryScreen;
}

export interface CompleteOutcome {
  status: "completed" | "duplicate";
  rewards: string[];
  screen: StoryScreen;
}
