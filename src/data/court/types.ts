import type { TerritoryOwner } from "@/data/realm/map";
import type { NpcStats, Position, RelationshipStatus } from "./npcs";

export type Wallet = { gold: number; food: number; knowledge: number; influence: number };

export interface NpcState {
  code: string;
  stats: NpcStats;
  status: RelationshipStatus;
  position: Position | null;
  recruited: boolean;
  lastInteractionDay: string | null;
  brokenSinceDay?: string | null;
  statusSinceDay?: string | null;
  absentUntilDay?: string | null;
  version: number;
}

/** Everything the court engine may look at. Built by the server from the database. */
export interface CourtFacts {
  day: string;
  heroName: string;
  heroLevel: number;
  npcs: Record<string, NpcState>;
  /** Resolved events: code → chosen option and local day. */
  resolved: Record<string, { choice: string; day: string }>;
  /** Codes of events currently waiting for a decision. */
  open: string[];
  territories: Record<string, TerritoryOwner>;
  resources: Wallet;
  morale: number;
  buildings: { palace: number; academy: number; barracks: number; castle: number };
}

export interface RelationDelta {
  a: string;
  b: string;
  affinity?: number;
  rivalry?: number;
  trust?: number;
}

export interface Outcome {
  /** Short narrative result shown after the choice. */
  text: string;
  npcs?: Record<string, Partial<NpcStats>>;
  /** Explicit status changes (romance only happens through events, with the character's consent). */
  status?: Record<string, RelationshipStatus>;
  relations?: RelationDelta[];
  resources?: Partial<Wallet>;
  morale?: number;
  /** A neutral or faction territory joins the realm peacefully. */
  territory?: string;
  /** Characters who lose their position. */
  dismiss?: string[];
  /** Local calendar return date; the NPC remains recruited and keeps their office. */
  absentUntil?: Record<string, string | null>;
}

export interface ChoiceDef {
  code: string;
  label: string;
  /** Close an obsolete conversation without applying relationship changes. */
  allowWhenUnavailable?: boolean;
  hint?: string | ((facts: CourtFacts) => string);
  cost?: Partial<Wallet>;
  /** Reason the option is closed right now, or null. */
  unavailable?: (f: CourtFacts) => string | null;
  resolve: (f: CourtFacts) => Outcome;
}

export interface CourtEventDef {
  code: string;
  kind: "quest" | "romance" | "intrigue" | "politics";
  /** Owner of a personal storyline. */
  npc?: string;
  step?: number;
  /** Repeat after this many local days since the most recent resolution. */
  cooldownDays?: number;
  title: string;
  participants: string[];
  text: string;
  /** Hint shown in the quest log while the step is locked. */
  hint?: string | ((facts: CourtFacts) => string);
  requires: (f: CourtFacts) => boolean;
  choices: ChoiceDef[];
}
