import Link from "next/link";
import { GameNav } from "@/components/game-nav";
import { OfflineBanner } from "@/components/ui/offline-banner";

export default function GameLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh pb-24 md:pb-8">
      <OfflineBanner />
      <header className="border-b-2 border-border bg-panel/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-2">
          <Link href="/dashboard" className="font-display text-lg text-gold tracking-wider">
            NEMESIS
          </Link>
          <div className="flex-1">
            <GameNav />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-4 sm:py-6">{children}</main>
    </div>
  );
}
