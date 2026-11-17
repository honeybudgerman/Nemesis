import Image from "next/image";
import { PixelSprite, type Palette } from "@/components/pixel/pixel-sprite";

/** Pixel portrait for Corvin, who has no anime artwork. */
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
const CORVIN_PALETTE: Palette = { H: "#1a1420", W: "#2a2230", S: "#c9a080", K, M: "#6a3a3a", B: "#4a4a55", D: "#2e2e36", G: "#8a8a99" };

const LOOKS = new Map([
  ["liara", { image: "liara", bg: "#13262a", ring: "#2f7d7a" }],
  ["selvina", { image: "yuki", bg: "#1d1530", ring: "#7a5ab0" }],
  ["torvald", { image: "torvald", bg: "#1b2026", ring: "#5d6b7a" }],
  ["meyrin", { image: "meirin", bg: "#132018", ring: "#3f7a4a" }],
  ["bram", { image: "bram", bg: "#2a1418", ring: "#a9822f" }],
  ["rein", { image: "rein", bg: "#141e33", ring: "#3b6fb6" }],
  ["ida", { image: "ida", bg: "#2a1622", ring: "#b5658a" }],
]);

export function CourtPortrait({ code, size = 64, title, dim = false }: { code: string; size?: number; title: string; dim?: boolean }) {
  const look = LOOKS.get(code);
  return (
    <div
      className="inline-flex shrink-0 items-end justify-center border-2 p-1"
      style={{ width: size + 12, height: size + 12, background: look?.bg ?? "#16161c", borderColor: look?.ring ?? "#6a6a7a", filter: dim ? "grayscale(0.85) brightness(0.55)" : undefined }}
    >
      {look ? (
        <Image src={`/assets/portraits/${look.image}.webp`} width={size} height={size} alt={title} className="object-cover" unoptimized />
      ) : (
        <PixelSprite rows={LORD} palette={CORVIN_PALETTE} size={size} title={title} />
      )}
    </div>
  );
}
