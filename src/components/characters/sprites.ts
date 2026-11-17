import type { Palette } from "@/components/pixel/pixel-sprite";

/** 16×16 ruler bust. Letters map to palette entries; "." is transparent. */
export const RULER_SPRITE: readonly string[] = [
  "................",
  "....G..GG..G....",
  "....GGGRRGGG....",
  "....GGGGGGGG....",
  "...KHHHHHHHHK...",
  "...HSSSSSSSSH...",
  "...HSKSSSSKSH...",
  "...HSSSSSSSSH...",
  "....SSSMMSSS....",
  ".....SSSSSS.....",
  "...BBBBGGBBBB...",
  "..BBBBBGGBBBBB..",
  "..SBBBBGGBBBBS..",
  "..SBBDDGGDDBBS..",
  "....DDD..DDD....",
  "....KKK..KKK....",
];

export const HERO_PALETTE: Palette = {
  G: "#e8b84a",
  R: "#e0565b",
  K: "#1a1222",
  H: "#7a4a2a",
  S: "#f1c9a0",
  M: "#b5655a",
  B: "#3b6fb6",
  D: "#26487a",
};

/** 16×12 castle icon for the kingdom panel. */
export const CASTLE_SPRITE: readonly string[] = [
  "..T.T......T.T..",
  "..TTT..F...TTT..",
  "..SSS..F...SSS..",
  "..SSS.TTT..SSS..",
  "..SSSTSSSTTSSS..",
  "..SSSSSSSSSSSS..",
  "..SSSSWSSWSSSS..",
  "..SSSSSSSSSSSS..",
  "..SSSSSDDSSSSS..",
  "..SSSSSDDSSSSS..",
  "GGGGGGGGGGGGGGGG",
  "gggggggggggggggg",
];

export const CASTLE_PALETTE: Palette = {
  T: "#8a7a9a",
  S: "#6a5a7a",
  W: "#e8b84a",
  D: "#2a1a10",
  F: "#e0565b",
  G: "#3f7a3a",
  g: "#2a5527",
};
