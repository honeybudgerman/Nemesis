"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface Item {
  href: string;
  label: string;
  icon: string;
  sprint?: number;
}

/** Locked sections show which sprint delivers them — no fake screens behind them. */
const ITEMS: Item[] = [
  { href: "/dashboard", label: "Тронный зал", icon: "👑" },
  { href: "/quests", label: "Задания", icon: "📜" },
  { href: "/skills", label: "Навыки", icon: "📚" },
  { href: "/rival", label: "Соперник", icon: "⚔️", sprint: 2 },
  { href: "/mentor", label: "Наставник", icon: "🔮", sprint: 3 },
  { href: "/kingdom", label: "Королевство", icon: "🏰", sprint: 4 },
  { href: "/court", label: "Двор", icon: "🎭", sprint: 5 },
  { href: "/chronicles", label: "Хроники", icon: "📖", sprint: 6 },
];

export function GameNav() {
  const path = usePathname();
  const active = ITEMS.filter((i) => !i.sprint);
  return (
    <>
      {/* desktop / tablet */}
      <nav className="hidden md:flex flex-wrap items-center gap-1" aria-label="Разделы">
        {ITEMS.map((i) =>
          i.sprint ? (
            <span key={i.href} className="px-2 py-1 text-sm text-muted/60" title={`Откроется в Sprint ${i.sprint}`}>
              {i.icon} {i.label} 🔒
            </span>
          ) : (
            <Link
              key={i.href}
              href={i.href}
              className={`px-2 py-1 text-sm font-display border-2 ${path.startsWith(i.href) ? "border-gold text-gold" : "border-transparent hover:border-border"}`}
            >
              {i.icon} {i.label}
            </Link>
          ),
        )}
        <Link href="/settings" className={`ml-auto px-2 py-1 text-sm border-2 ${path.startsWith("/settings") ? "border-gold text-gold" : "border-transparent hover:border-border"}`}>
          ⚙️
        </Link>
      </nav>
      {/* mobile bottom bar */}
      <nav
        className="md:hidden fixed inset-x-0 bottom-0 z-40 flex border-t-2 border-border bg-panel"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Разделы"
      >
        {[...active, { href: "/settings", label: "Ещё", icon: "⚙️" }].map((i) => (
          <Link
            key={i.href}
            href={i.href}
            className={`flex flex-1 flex-col items-center py-2 text-xs font-display ${path.startsWith(i.href) ? "text-gold" : "text-muted"}`}
          >
            <span className="text-lg" aria-hidden>
              {i.icon}
            </span>
            {i.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
