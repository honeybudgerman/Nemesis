import { CourtPortrait } from "@/components/characters/court-portrait";
import { Portrait } from "@/components/characters/portrait";
import { ImagePortrait, PORTRAIT_IMAGES } from "@/components/characters/portrait-images";
import { PixelSprite, type Palette } from "@/components/pixel/pixel-sprite";
import type { Speaker } from "@/data/story/chapters";

/** 16×16 bandit chief: scarred, bearded, hooded. */
const BANDIT: readonly string[] = [
  "................",
  ".....HHHHHH.....",
  "....HHHHHHHH....",
  "...HHSSSSSSHH...",
  "...HSSKSSKSSH...",
  "...HSSSSSXSSH...",
  "...HWSSSSSXWH...",
  "....WWMMMMWW....",
  "....WWWWWWWW....",
  ".....WWWWWW.....",
  "...BBBLLLLBBB...",
  "..BBBBBLLBBBBB..",
  "..BBBBBLLBBBB...",
  "..BBDDDLLDDD....",
  "..DDDDDDDDDD....",
  "..DDDDDDDDDD....",
];
const BANDIT_PALETTE: Palette = { H: "#3a4a2a", S: "#c9966a", K: "#1a1222", X: "#8a3b2a", W: "#5a3a20", M: "#7a3a2a", B: "#4a3a2a", D: "#2a2018", L: "#8a6a40" };

/** 16×16 black guard in a closed helm. */
const KNIGHT: readonly string[] = [
  "................",
  "......RRRR......",
  ".....HHHHHH.....",
  "....HHHHHHHH....",
  "...HHHHHHHHHH...",
  "...HHKKKKKKHH...",
  "...HHEHHHHEHH...",
  "...HHKKKKKKHH...",
  "...HHHHKKHHHH...",
  "....HHHHHHHH....",
  "...AAAAGGAAAA...",
  "..AAAAAGGAAAAA..",
  "..AAAAAGGAAAAA..",
  "..AACCCGGCCCAA..",
  "..CCCCCCCCCCCC..",
  "..CCCCCCCCCCCC..",
];
const KNIGHT_PALETTE: Palette = { R: "#c04dd6", H: "#2e2a36", K: "#0e0c12", E: "#e0565b", A: "#3a3644", G: "#8d8a99", C: "#1a1622" };

const COURT = new Set<Speaker>(["liara", "selvina", "torvald", "meyrin", "bram"]);

export function SpeakerPortrait({ speaker, name, size = 96 }: { speaker: Speaker; name: string; size?: number }) {
  if (speaker === "hero") return <Portrait kind="hero" size={size} title={name} />;
  if (speaker === "mentor") return <Portrait kind="mentor" size={size} title={name} />;
  if (speaker === "rival") return <Portrait kind="rival" size={size} title={name} />;
  if (COURT.has(speaker)) return <CourtPortrait code={speaker} size={size} title={name} />;
  if ((speaker === "bandit" || speaker === "morven") && PORTRAIT_IMAGES[speaker]) {
    return <ImagePortrait src={PORTRAIT_IMAGES[speaker]} size={size} title={name} ring="var(--danger)" bg="#1a1014" />;
  }
  if (speaker === "bandit" || speaker === "morven") {
    const rows = speaker === "bandit" ? BANDIT : KNIGHT;
    const palette = speaker === "bandit" ? BANDIT_PALETTE : KNIGHT_PALETTE;
    return (
      <div className="inline-flex shrink-0 items-end justify-center border-2 border-danger bg-[#1a1014] p-1" style={{ width: size + 12, height: size + 12 }}>
        <PixelSprite rows={rows} palette={palette} size={size} title={name} />
      </div>
    );
  }
  return null; // the narrator has no face
}
