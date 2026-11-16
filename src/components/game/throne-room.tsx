"use client";

import Link from "next/link";
import { Portrait } from "@/components/characters/portrait";
import { CASTLE_PALETTE, CASTLE_SPRITE } from "@/components/characters/sprites";
import { PixelSprite } from "@/components/pixel/pixel-sprite";
import { QuestCard } from "@/components/quests/quest-card";
import { XpBar } from "@/components/ui/xp-bar";
import { RESOURCE_LABELS } from "@/data/kingdom";
import { mentorLine } from "@/data/mentor/lines";
import { describeEvent, formatWhen } from "@/lib/events";
import { useUiStore } from "@/stores/ui-store";
import type { StorySummary } from "@/types/game";
import { useEffect, useRef } from "react";
import { StateGate } from "./state-gate";

export function ThroneRoom() {
  return (
    <StateGate>
      {(s) => {
        const main = s.quests.daily.filter((q) => !q.isOptional);
        const mainDone = main.filter((q) => q.status === "COMPLETED").length;
        const lastEvent = s.recentEvents[0];
        const orion = mentorLine({
          heroName: s.profile.heroName,
          date: s.periods.today,
          mainTotal: main.length,
          mainDone,
          anyDoneToday: s.xp.today > 0,
        });

        return (
          <div className="grid gap-4 lg:grid-cols-3">
            {/* Hero vs Rival */}
            <section className="pixel-panel pixel-panel-gold p-4 lg:col-span-2" aria-label="Правители">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex gap-3">
                  <Portrait kind="hero" size={72} title={s.profile.heroName} />
                  <div className="min-w-0 flex-1">
                    <div className="font-display text-lg text-gold truncate">{s.profile.heroName}</div>
                    {s.story?.title && <div className="font-display text-xs text-gold">«{s.story.title}»</div>}
                    <div className="text-xs text-muted">
                      {s.profile.rank} · {s.profile.kingdomName}
                    </div>
                    <div className="mt-1 font-display text-2xl">Ур. {s.profile.level}</div>
                    <XpBar value={s.profile.progress.xpIntoLevel} max={s.profile.progress.xpForNext} />
                  </div>
                </div>
                <Link href="/rival" className="flex gap-3 sm:border-l-2 sm:border-border sm:pl-4 hover:opacity-90">
                  <Portrait kind="rival" size={72} title={s.rival?.name ?? "Каэль Валькарион"} />
                  <div className="min-w-0 flex-1">
                    <div className="font-display text-lg text-rival truncate">{s.rival?.name ?? "Каэль Валькарион"}</div>
                    <div className="text-xs text-muted">Соперник · Чёрный Предел</div>
                    {s.rival ? (
                      <>
                        <div className="mt-1 font-display text-2xl">Ур. {s.rival.level}</div>
                        <XpBar value={s.rival.progress.xpIntoLevel} max={s.rival.progress.xpForNext} label="Опыт Каэля" />
                        {s.rival.lastAction && <p className="mt-1 text-xs text-muted line-clamp-2">{s.rival.lastAction.text}</p>}
                      </>
                    ) : (
                      <p className="mt-1 text-xs text-muted">Данные соперника временно недоступны.</p>
                    )}
                  </div>
                </Link>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <Stat label="XP сегодня" value={s.xp.today} />
                <Stat label="XP за неделю" value={s.xp.week} />
                <Stat
                  label="Каэль за неделю"
                  value={s.rival ? s.rival.weekXp : "—"}
                  muted={!s.rival}
                  rival
                />
              </div>
            </section>

            {/* Orion */}
            <section className="pixel-panel p-4" aria-label="Наставник Орион">
              <div className="flex gap-3">
                <Portrait kind="mentor" size={48} title="Орион" />
                <div>
                  <div className="font-display text-mana">Орион</div>
                  <p className="mt-1 text-sm text-text/90">«{orion}»</p>
                </div>
              </div>
            </section>

            {s.story && <StoryCard story={s.story} />}

            {/* Today's quests */}
            <section className="lg:col-span-2" aria-label="Задания на сегодня">
              <div className="mb-2 flex items-baseline justify-between">
                <h2 className="font-display text-lg text-gold">Задания на сегодня</h2>
                <span className="text-sm text-muted font-display">
                  {mainDone}/{main.length}
                </span>
              </div>
              <div className="grid gap-3">
                {main.map((q) => (
                  <QuestCard key={q.id} quest={q} compact />
                ))}
              </div>
              <Link href="/quests" className="mt-3 inline-block text-sm text-gold underline">
                Все задания: неделя, месяц, необязательные →
              </Link>
            </section>

            <div className="grid content-start gap-4">
              {/* Kingdom */}
              <section className="pixel-panel p-4" aria-label="Королевство">
                <div className="flex items-center gap-3">
                  <PixelSprite rows={CASTLE_SPRITE} palette={CASTLE_PALETTE} size={56} />
                  <div className="font-display text-gold">{s.kingdom.name}</div>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  <Res label={RESOURCE_LABELS.gold} icon="🪙" value={s.kingdom.gold} />
                  <Res label={RESOURCE_LABELS.food} icon="🌾" value={s.kingdom.food} />
                  <Res label={RESOURCE_LABELS.knowledge} icon="📘" value={s.kingdom.knowledge} />
                  <Res label={RESOURCE_LABELS.influence} icon="🎖️" value={s.kingdom.influence} />
                  <Res label={RESOURCE_LABELS.command_points} icon="🚩" value={s.kingdom.commandPoints} wide />
                </dl>
                <Link href="/kingdom" className="pixel-btn mt-3 block w-full text-center text-sm">
                  🗺️ Карта королевства
                </Link>
              </section>

              {/* Chronicle */}
              <section className="pixel-panel p-4" aria-label="Хроника">
                <h2 className="font-display text-gold">Последнее в хронике</h2>
                {lastEvent ? (
                  <p className="mt-1 text-sm">
                    <span className="text-muted">{formatWhen(lastEvent.createdAt)} · </span>
                    {describeEvent(lastEvent)}
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-muted">Пока пусто.</p>
                )}
              </section>
            </div>
          </div>
        );
      }}
    </StateGate>
  );
}

const STAGE_TEXT: Record<NonNullable<StorySummary["chapter"]>["stage"], string> = {
  intro: "Новая глава ждёт начала.",
  objectives: "Выполняйте цели главы реальными делами.",
  boss: "Цели выполнены: впереди сюжетный бой.",
  ready: "Глава готова к завершению.",
  completed: "Глава пройдена.",
};

function StoryCard({ story }: { story: StorySummary }) {
  const push = useUiStore((st) => st.pushToast);
  const shown = useRef("");
  useEffect(() => {
    const key = story.newAchievements.join("|");
    if (!key || shown.current === key) return;
    shown.current = key;
    for (const name of story.newAchievements) push("level", `Достижение: «${name}»`);
  }, [story.newAchievements, push]);

  return (
    <section className={`pixel-panel p-4 ${story.pendingScene ? "pixel-panel-gold" : ""}`} aria-label="Сюжет">
      <h2 className="font-display text-gold">📖 Сюжет</h2>
      {story.chapter ? (
        <>
          <p className="mt-1 font-display text-sm">
            Глава {story.chapter.number}. {story.chapter.title}
          </p>
          <p className="text-xs text-muted">{STAGE_TEXT[story.chapter.stage]}</p>
        </>
      ) : (
        <p className="mt-1 text-sm">Первая книга пройдена. Продолжение следует.</p>
      )}
      <Link href="/chronicles" className={`pixel-btn mt-3 block w-full text-center text-sm ${story.pendingScene ? "pixel-btn-gold anim-pulse" : ""}`}>
        {story.pendingScene ? "▶ Смотреть новую сцену" : "Открыть хроники"}
      </Link>
    </section>
  );
}

function Stat({ label, value, muted, rival }: { label: string; value: number | string; muted?: boolean; rival?: boolean }) {
  return (
    <div className="border-2 border-border bg-bg-deep p-2">
      <div className={`font-display text-xl ${muted ? "text-muted" : rival ? "text-rival" : "text-xp"}`}>{value}</div>
      <div className="text-[11px] text-muted">{label}</div>
    </div>
  );
}

function Res({ label, icon, value, wide }: { label: string; icon: string; value: number; wide?: boolean }) {
  return (
    <div className={`flex justify-between gap-2 ${wide ? "col-span-2" : ""}`}>
      <dt className="text-muted">
        <span aria-hidden>{icon}</span> {label}
      </dt>
      <dd className="font-display">{value.toLocaleString("ru-RU")}</dd>
    </div>
  );
}
