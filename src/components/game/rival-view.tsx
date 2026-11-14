"use client";

import { Portrait } from "@/components/characters/portrait";
import { XpBar } from "@/components/ui/xp-bar";
import { RESOURCE_LABELS } from "@/data/kingdom";
import { SKILL_ICONS, SKILL_LABELS, isSkillCode } from "@/data/skills";
import { useRivalCatchUp, useRivalView } from "@/hooks/use-rival";
import type { HeroStats, RivalActionView, RivalView as RivalData } from "@/types/game";

const STAT_LABELS: Record<keyof HeroStats, string> = {
  wisdom: "Мудрость",
  willpower: "Сила воли",
  strategy: "Стратегия",
  management: "Управление",
  capital: "Капитал",
  compassion: "Сострадание",
};

const OUTCOME_STYLE: Record<RivalActionView["outcome"], { label: string; cls: string }> = {
  SUCCESS: { label: "Успех", cls: "text-xp" },
  PARTIAL: { label: "Частично", cls: "text-gold" },
  FAIL: { label: "Провал", cls: "text-danger" },
  REST: { label: "Отдых", cls: "text-muted" },
};

export function RivalView() {
  const { data, error, isPending, refetch } = useRivalView();
  useRivalCatchUp(data?.pendingDays ?? 0);

  if (isPending) return <div className="py-16 text-center font-display text-muted">Разведчики собирают донесения…</div>;
  if (!data) {
    return (
      <div className="pixel-panel p-6 text-center">
        <p className="text-danger">{error instanceof Error ? error.message : "Не удалось загрузить данные о сопернике."}</p>
        <button className="pixel-btn mt-4" onClick={() => refetch()}>
          Повторить
        </button>
      </div>
    );
  }
  return <RivalScreen r={data} />;
}

export function RivalScreen({ r }: { r: RivalData }) {
  const days = groupByDay(r.actions);
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* Card */}
      <section className="pixel-panel p-4 lg:col-span-2" aria-label="Соперник">
        <div className="flex gap-4">
          <Portrait kind="rival" size={96} title={r.name} />
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-2xl text-rival">{r.name}</h1>
            <div className="text-sm text-muted">Правитель королевства «{r.kingdom.name}»</div>
            <div className="mt-2 font-display text-3xl">Ур. {r.level}</div>
            <XpBar value={r.progress.xpIntoLevel} max={r.progress.xpForNext} label="Опыт Каэля" />
            <div className="mt-1 text-xs text-muted">Всего: {r.totalXp.toLocaleString("ru-RU")} XP</div>
          </div>
        </div>
        <p className="mt-3 text-sm text-text/90">
          Каэль живёт своей жизнью: каждый день он сам решает, чем заняться, иногда устаёт, отдыхает и ошибается. Он
          получает опыт по тем же правилам, что и вы, и ваши успехи на его темп не влияют.
        </p>
        {r.pendingDays > 0 && (
          <p className="mt-2 text-xs text-muted">Восстанавливаю хронику за пропущенные дни: осталось {r.pendingDays}…</p>
        )}
      </section>

      {/* Comparison */}
      <section className="pixel-panel pixel-panel-gold p-4" aria-label="Сравнение">
        <h2 className="font-display text-gold">Вы и Каэль</h2>
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="text-xs text-muted">
              <th className="text-left font-normal" />
              <th className="text-right font-normal">Вы</th>
              <th className="text-right font-normal">Каэль</th>
            </tr>
          </thead>
          <tbody className="font-display">
            <CompareRow label="Уровень" mine={r.hero.level} theirs={r.level} />
            <CompareRow label="XP за неделю" mine={r.hero.weekXp} theirs={r.weekXp} />
            <CompareRow label="Всего XP" mine={r.hero.totalXp} theirs={r.totalXp} />
          </tbody>
        </table>
        <p className="mt-3 text-xs text-muted">{verdict(r)}</p>
      </section>

      {/* Chronicle */}
      <section className="lg:col-span-2" aria-label="Хроника Каэля">
        <h2 className="font-display text-lg text-gold">Хроника Каэля</h2>
        <p className="text-xs text-muted">Откуда у него опыт: каждое действие, его итог и награда.</p>
        {days.length === 0 ? (
          <p className="mt-2 pixel-panel p-4 text-sm text-muted">
            Каэль только появился. Первые записи появятся завтра, когда закончится его первый день.
          </p>
        ) : (
          <div className="mt-2 grid gap-3">
            {days.map(([day, actions]) => (
              <div key={day} className="pixel-panel p-3">
                <div className="flex items-baseline justify-between">
                  <div className="font-display text-sm">{formatDay(day)}</div>
                  <div className="font-display text-sm text-rival">+{actions.reduce((s, a) => s + a.xp, 0)} XP</div>
                </div>
                <ul className="mt-1 grid gap-1">
                  {actions.map((a) => (
                    <li key={a.id} className="flex gap-2 text-sm">
                      <span className={`w-20 shrink-0 text-xs font-semibold ${OUTCOME_STYLE[a.outcome].cls}`}>
                        {OUTCOME_STYLE[a.outcome].label}
                      </span>
                      <span className="min-w-0 flex-1">
                        {a.text}
                        {a.type === "STUDY" && (
                          <span className="text-xs text-muted">
                            {" "}
                            ({a.minutes} мин{a.grade ? `, оценка ${a.grade}` : ""}
                            {a.gold !== 0 ? `, ${a.gold > 0 ? "+" : ""}${a.gold} золота` : ""})
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="grid content-start gap-4">
        {/* Skills */}
        <section className="pixel-panel p-4" aria-label="Навыки Каэля">
          <h2 className="font-display text-gold">Навыки</h2>
          <ul className="mt-2 grid gap-2 text-sm">
            {r.skills.map((sk) => (
              <li key={sk.code}>
                <div className="flex justify-between gap-2">
                  <span>
                    <span aria-hidden>{isSkillCode(sk.code) ? SKILL_ICONS[sk.code] : "★"}</span>{" "}
                    {isSkillCode(sk.code) ? SKILL_LABELS[sk.code] : sk.code}
                  </span>
                  <span className="font-display">
                    <span className="text-rival">{sk.level}</span>
                    <span className="text-xs text-muted"> / вы {sk.heroLevel}</span>
                  </span>
                </div>
                <XpBar value={sk.progress.xpIntoLevel} max={sk.progress.xpForNext} label={`Опыт Каэля: ${sk.code}`} />
              </li>
            ))}
          </ul>
        </section>

        {/* Stats + kingdom */}
        <section className="pixel-panel p-4" aria-label="Характеристики и королевство">
          <h2 className="font-display text-gold">Характеристики</h2>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            {(Object.keys(STAT_LABELS) as (keyof HeroStats)[]).map((k) => (
              <div key={k} className="flex justify-between gap-2">
                <dt className="text-muted">{STAT_LABELS[k]}</dt>
                <dd className="font-display">{r.stats[k]}</dd>
              </div>
            ))}
          </dl>
          <h2 className="mt-4 font-display text-gold">{r.kingdom.name}</h2>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            <Res label={RESOURCE_LABELS.gold} icon="🪙" value={r.kingdom.gold} />
            <Res label={RESOURCE_LABELS.food} icon="🌾" value={r.kingdom.food} />
            <Res label={RESOURCE_LABELS.knowledge} icon="📘" value={r.kingdom.knowledge} />
            <Res label={RESOURCE_LABELS.influence} icon="🎖️" value={r.kingdom.influence} />
          </dl>
        </section>
      </div>
    </div>
  );
}

function CompareRow({ label, mine, theirs }: { label: string; mine: number; theirs: number }) {
  return (
    <tr className="border-t border-border">
      <td className="py-1 font-sans text-muted">{label}</td>
      <td className={`py-1 text-right ${mine >= theirs ? "text-xp" : ""}`}>{mine.toLocaleString("ru-RU")}</td>
      <td className={`py-1 text-right ${theirs > mine ? "text-rival" : ""}`}>{theirs.toLocaleString("ru-RU")}</td>
    </tr>
  );
}

function Res({ label, icon, value }: { label: string; icon: string; value: number }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted">
        <span aria-hidden>{icon}</span> {label}
      </dt>
      <dd className="font-display">{value.toLocaleString("ru-RU")}</dd>
    </div>
  );
}

function verdict(r: RivalData): string {
  const diff = r.hero.weekXp - r.weekXp;
  if (r.weekXp === 0 && r.hero.weekXp === 0) return "Неделя только началась. Первый ход за вами.";
  if (diff > 0) return `На этой неделе вы впереди на ${diff} XP. Каэль это заметит.`;
  if (diff < 0) return `На этой неделе Каэль впереди на ${-diff} XP. Одно задание может это изменить.`;
  return "На этой неделе вы идёте вровень.";
}

function groupByDay(actions: RivalActionView[]): [string, RivalActionView[]][] {
  const map = new Map<string, RivalActionView[]>();
  for (const a of actions) {
    const list = map.get(a.day) ?? [];
    list.push(a);
    map.set(a.day, list);
  }
  return [...map.entries()].map(([d, list]) => [d, list.sort((x, y) => x.index - y.index)]);
}

function formatDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("ru-RU", {
    weekday: "short",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}
