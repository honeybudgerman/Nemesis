import Image from "next/image";

type Kind = "hero" | "rival" | "mentor";

const CONFIG: Record<Kind, { image: string; ring: string; bg: string }> = {
  hero: { image: "hero", ring: "border-gold-dim", bg: "bg-[#1b2440]" },
  rival: { image: "kael", ring: "border-rival", bg: "bg-[#2a1230]" },
  mentor: { image: "orion", ring: "border-mana", bg: "bg-[#151d36]" },
};

export function Portrait({ kind, size = 80, title, dim = false }: { kind: Kind; size?: number; title: string; dim?: boolean }) {
  const c = CONFIG[kind];
  return (
    <div
      className={`inline-flex items-end justify-center border-2 ${c.ring} ${c.bg} p-1 shrink-0`}
      style={{ width: size + 12, height: size + 12, filter: dim ? "grayscale(0.7) brightness(0.6)" : undefined }}
    >
      <Image src={`/assets/portraits/${c.image}.webp`} width={size} height={size} alt={title} className="object-cover" unoptimized />
    </div>
  );
}
