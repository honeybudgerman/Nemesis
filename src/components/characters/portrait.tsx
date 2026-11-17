import { PixelSprite } from "@/components/pixel/pixel-sprite";
import { ImagePortrait, PORTRAIT_IMAGES } from "./portrait-images";
import { HERO_PALETTE, MENTOR_PALETTE, MENTOR_SPRITE, RIVAL_PALETTE, RULER_SPRITE } from "./sprites";

type Kind = "hero" | "rival" | "mentor";

const CONFIG: Record<Kind, { rows: readonly string[]; palette: Record<string, string>; ring: string; bg: string }> = {
  hero: { rows: RULER_SPRITE, palette: HERO_PALETTE, ring: "border-gold-dim", bg: "bg-[#1b2440]" },
  rival: { rows: RULER_SPRITE, palette: RIVAL_PALETTE, ring: "border-rival", bg: "bg-[#2a1230]" },
  mentor: { rows: MENTOR_SPRITE, palette: MENTOR_PALETTE, ring: "border-mana", bg: "bg-[#151d36]" },
};

const RING: Record<Kind, string> = { hero: "var(--gold-dim)", rival: "var(--rival)", mentor: "var(--mana)" };

export function Portrait({ kind, size = 80, title, dim = false }: { kind: Kind; size?: number; title: string; dim?: boolean }) {
  const c = CONFIG[kind];
  const img = PORTRAIT_IMAGES[kind];
  if (img) return <ImagePortrait src={img} size={size} title={title} ring={RING[kind]} bg="#151d36" dim={dim} />;
  return (
    <div
      className={`inline-flex items-end justify-center border-2 ${c.ring} ${c.bg} p-1 shrink-0`}
      style={{ width: size + 12, height: size + 12, filter: dim ? "grayscale(0.7) brightness(0.6)" : undefined }}
    >
      <PixelSprite rows={c.rows} palette={c.palette} size={size} title={title} />
    </div>
  );
}
