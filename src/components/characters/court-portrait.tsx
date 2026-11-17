import { PixelSprite, type Palette } from "@/components/pixel/pixel-sprite";
import { ImagePortrait, PORTRAIT_IMAGES } from "./portrait-images";

/** 16×16 busts for court characters: long hair (lady) and short hair with beard slot (lord). */
const LADY: readonly string[] = [
  "................",
  ".....HHHHHH.....",
  "....HHHHHHHH....",
  "...HHSSSSSSHH...",
  "...HSSSSSSSSH...",
  "...HSKSSSSKSH...",
  "...HSSSSSSSSH...",
  "...HHSSMMSSHH...",
  "...HHHSSSSHHH...",
  "..HHHHGSSGHHHH..",
  "..HHBBBGGBBBHH..",
  "..HBBBBBBBBBBH..",
  "..HBBBBDDBBBBH..",
  "...BBBDDDDBBB...",
  "...BBDDDDDDBB...",
  "...DDDDDDDDDD...",
];

const LORD: readonly string[] = [
  "................",
  "....HHHHHHHH....",
  "...HHHHHHHHHH...",
  "...HSSSSSSSSH...",
  "...SSKSSSSKSS...",
  "...SSSSSSSSSS...",
  "....SSSSSSSS....",
  "....SWMMMMWS....",
  "....WWWWWWWW....",
  ".....WWWWWW.....",
  "...BBBGGGGBBB...",
  "..BBBBBGGBBBBB..",
  "..BBBBBGGBBBBB..",
  "..BBDDDGGDDDBB..",
  "..DDDDDDDDDDDD..",
  "..DDDDDDDDDDDD..",
];

const K = "#1a1222";
const LOOKS: Record<string, { rows: readonly string[]; palette: Palette; bg: string; ring: string }> = {
  liara: { rows: LADY, palette: { H: "#8a3b2a", S: "#e9c39b", K, M: "#b5555a", B: "#2f7d7a", D: "#1d4f4d", G: "#e8b84a" }, bg: "#13262a", ring: "#2f7d7a" },
  selvina: { rows: LADY, palette: { H: "#d8d4e8", S: "#f0d6c0", K, M: "#a8607a", B: "#5a3a8a", D: "#36225a", G: "#7ab8ec" }, bg: "#141a33", ring: "#5a8ad0" },
  torvald: { rows: LORD, palette: { H: "#8d8a99", W: "#a9a6b5", S: "#d9a882", K, M: "#7a4a3a", B: "#5d6b7a", D: "#3a4450", G: "#c0392b" }, bg: "#1b2026", ring: "#5d6b7a" },
  meyrin: { rows: LADY, palette: { H: "#b8b4c4", S: "#e3c2a3", K, M: "#9a5a5a", B: "#2f5a3a", D: "#1d3b25", G: "#e8b84a" }, bg: "#132018", ring: "#3f7a4a" },
  bram: { rows: LORD, palette: { H: "#6b4423", W: "#f0c8a0", S: "#f0c8a0", K, M: "#a0503a", B: "#7a2a3a", D: "#4a1824", G: "#e8b84a" }, bg: "#2a1418", ring: "#a9822f" },
  rein: { rows: LORD, palette: { H: "#e0c070", W: "#edc49e", S: "#edc49e", K, M: "#b5655a", B: "#3b6fb6", D: "#26487a", G: "#dcdcdc" }, bg: "#141e33", ring: "#3b6fb6" },
  ida: { rows: LADY, palette: { H: "#d08850", S: "#f3d0b0", K, M: "#c0607a", B: "#b5658a", D: "#7a3a5a", G: "#e8b84a" }, bg: "#2a1622", ring: "#b5658a" },
  corvin: { rows: LORD, palette: { H: "#1a1420", W: "#2a2230", S: "#c9a080", K: "#e0565b", M: "#6a3a3a", B: "#4a4a55", D: "#2e2e36", G: "#8a8a99" }, bg: "#16161c", ring: "#6a6a7a" },
};

export function CourtPortrait({ code, size = 64, title, dim = false }: { code: string; size?: number; title: string; dim?: boolean }) {
  const look = LOOKS[code] ?? LOOKS.corvin;
  const img = PORTRAIT_IMAGES[code];
  if (img) return <ImagePortrait src={img} size={size} title={title} ring={look.ring} bg={look.bg} dim={dim} />;
  return (
    <div
      className="inline-flex shrink-0 items-end justify-center border-2 p-1"
      style={{ width: size + 12, height: size + 12, background: look.bg, borderColor: look.ring, filter: dim ? "grayscale(0.85) brightness(0.55)" : undefined }}
    >
      <PixelSprite rows={look.rows} palette={look.palette} size={size} title={title} />
    </div>
  );
}
