/**
 * Illustrated portraits (anime art from the Respawn project and generated art).
 * A character without an image here keeps its pixel sprite. To add one: put a
 * square WebP into public/portraits/ and list it below.
 */
export const PORTRAIT_IMAGES: Readonly<Record<string, string>> = {
  hero: "/portraits/hero.webp",
  selvina: "/portraits/yuki.webp", // Юки
};

export function ImagePortrait({ src, size, title, ring, bg, dim }: { src: string; size: number; title: string; ring: string; bg: string; dim?: boolean }) {
  return (
    <div
      className="inline-flex shrink-0 overflow-hidden border-2"
      style={{ width: size + 12, height: size + 12, borderColor: ring, background: bg, filter: dim ? "grayscale(0.8) brightness(0.55)" : undefined }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- small static art, no optimisation needed */}
      <img src={src} alt={title} width={size + 8} height={size + 8} loading="lazy" decoding="async" className="h-full w-full object-cover" />
    </div>
  );
}
