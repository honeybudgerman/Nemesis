"use client";

import { XpBar } from "@/components/ui/xp-bar";
import { SKILL_ICONS, SKILL_LABELS, isSkillCode } from "@/data/skills";
import type { HeroStats } from "@/types/game";
import { StateGate } from "./state-gate";

const STAT_LABELS: Record<keyof HeroStats, string> = {
  wisdom: "Мудрость",
  willpower: "Сила воли",
  strategy: "Стратегия",
  management: "Управление",
  capital: "Капитал",
  compassion: "Сострадание",
};

export function SkillsView() {
  return (
    <StateGate>
      {(s) => (
        <div className="grid gap-4 lg:grid-cols-3">
          <section className="lg:col-span-2">
            <h1 className="font-pixel text-2xl text-gold">Навыки</h1>
            <p className="mt-1 text-sm text-muted">Навык растёт от заданий своей категории. Ветки развития откроются вместе с наставником.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {s.skills.map((sk) => (
                <div key={sk.code} className="pixel-panel p-3">
                  <div className="flex items-center justify-between">
                    <div className="font-pixel">
                      <span aria-hidden>{isSkillCode(sk.code) ? SKILL_ICONS[sk.code] : "★"}</span>{" "}
                      {isSkillCode(sk.code) ? SKILL_LABELS[sk.code] : sk.code}
                    </div>
                    <div className="font-pixel text-gold">Ур. {sk.level}</div>
                  </div>
                  <div className="mt-2">
                    <XpBar value={sk.progress.xpIntoLevel} max={sk.progress.xpForNext} label={`Опыт навыка ${sk.code}`} />
                  </div>
                </div>
              ))}
            </div>
          </section>
          <section className="pixel-panel p-4 content-start">
            <h2 className="font-pixel text-gold">Характеристики героя</h2>
            <dl className="mt-2 grid gap-2 text-sm">
              {(Object.keys(STAT_LABELS) as (keyof HeroStats)[]).map((k) => (
                <div key={k}>
                  <div className="flex justify-between">
                    <dt className="text-muted">{STAT_LABELS[k]}</dt>
                    <dd className="font-pixel">{s.stats[k]}/100</dd>
                  </div>
                  <div className="xp-bar mt-1" style={{ height: 8 }}>
                    <span style={{ width: `${s.stats[k]}%`, background: "var(--gold)" }} />
                  </div>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-muted">
              Всего опыта: {s.profile.totalXp.toLocaleString("ru-RU")} XP
            </p>
          </section>
        </div>
      )}
    </StateGate>
  );
}
