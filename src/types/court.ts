import type { Interaction, NpcRole, NpcSkill, NpcStats, Position, RelationshipStatus } from "@/data/court/npcs";
import type { Wallet } from "@/data/court/types";
import type { QuestStepView } from "@/engine/court/court";

export interface NpcCard {
  code: string;
  name: string;
  age: number;
  role: NpcRole;
  title: string;
  major: boolean;
  romanceable: boolean;
  recruited: boolean;
  joinHint: string | null;
  status: RelationshipStatus;
  position: Position | null;
  stats: NpcStats;
  mood: "warm" | "neutral" | "cold";
  interactedToday: boolean;
  quest: { done: number; total: number } | null;
}

export interface ChoiceView {
  code: string;
  label: string;
  hint: string | null;
  cost: Partial<Wallet>;
  blocked: string | null;
}

export interface CourtEventView {
  id: string;
  code: string;
  kind: "quest" | "romance" | "intrigue" | "politics";
  title: string;
  text: string;
  participants: { code: string; name: string }[];
  choices: ChoiceView[];
}

export interface PositionView {
  position: Position;
  name: string;
  icon: string;
  effect: string;
  holder: string | null;
  bonus: string | null;
  candidates: { code: string; name: string; blocked: string | null }[];
}

export interface CourtHistoryItem {
  code: string;
  title: string;
  choice: string;
  text: string;
  day: string;
}

export interface CourtScreen {
  today: string;
  heroName: string;
  resources: Wallet;
  npcs: NpcCard[];
  events: CourtEventView[];
  positions: PositionView[];
  dailyBonus: Wallet;
  history: CourtHistoryItem[];
}

export interface NpcDetail {
  card: NpcCard;
  bio: string;
  goals: string;
  traits: string[];
  skills: Record<NpcSkill, number>;
  relations: { code: string; name: string; type: string; affinity: number; rivalry: number; trust: number }[];
  quests: QuestStepView[];
  messages: { id: string; action: Interaction; content: string; source: "AI" | "FALLBACK"; at: string }[];
  interactions: { action: Interaction; name: string; icon: string; description: string; cost: number; blocked: string | null }[];
}

export interface OutcomeView {
  title: string;
  choice: string;
  text: string;
  effects: string[];
}
