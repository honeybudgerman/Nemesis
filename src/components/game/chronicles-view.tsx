"use client";

import { useEffect, useRef, useState } from "react";
import { StoryBackdrop } from "@/components/story/backdrop";
import { Cutscene } from "@/components/story/cutscene";
import { SpeakerPortrait } from "@/components/story/speaker-portrait";
import { TACTICS, UNIT_TYPES, UNITS, type Tactic } from "@/data/realm/units";
import { estimateRisk } from "@/engine/realm/battle";
import { formatWhen } from "@/lib/events";
import { useBoss, useChronicle, useCompleteChapter, useMarkSeen, useSetTitle, useStory, useStoryChoose } from "@/hooks/use-story";
import { useUiStore } from "@/stores/ui-store";
import type { BossOutcome, ChapterView, SceneView, StoryScreen, TimelineCategory } from "@/types/story";

type Tab = "story" | "achievements" | "titles" | "history";
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "story", label: "Сюжет", icon: "📖" },
  { id: "achievements", label: "Достижения", icon: "🏅" },
  { id: "titles", label: "Титулы и реликвии", icon: "👑" },
  { id: "history", label: "История", icon: "📜" },
];

const STAGE_LABEL: Record<ChapterView["stage"], string> = {
  intro: "Пролог",
  objectives: "Цели главы",
  boss: "Сюжетный бой",
  ready: "Финал главы",
  completed: "Пройдена",
};

const RISK = {
  low: { label: "Низкий риск", cls: "text-xp" },
  medium: { label: "Средний риск", cls: "text-gold" },
  high: { label: "Высокий риск", cls: "text-danger" },
} as const;

export function ChroniclesView() {
  const { data, error, isPending, refetch } = useStory();
  if (isPending) return <div className="py-16 text-center font-display text-muted">Летописец раскрывает книгу…</div>;
  if (!data) {
    return (
      <div className="pixel-panel p-6 text-center">
        <p className="text-danger">{error instanceof Error ? error.message : "Не удалось загрузить хроники."}</p>
        <button className="pixel-btn mt-4" onClick={() => refetch()}>
          Повторить
        </button>
      </div>
    );
  }
  return <ChroniclesScreenView s={data} />;
}

interface OpenScene {
  view: SceneView;
  mark: { chapter: string; scene: "intro" | "outro" } | null;
}

export function ChroniclesScreenView({
  s,
  initialTab = "story",
  initialScene,
  initialBoss,
  autoplay = true,
}: {
  s: StoryScreen;
  initialTab?: Tab;
  initialScene?: SceneView;
  initialBoss?: BossOutcome["battle"];
  autoplay?: boolean;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [scene, setScene] = useState<OpenScene | null>(initialScene ? { view: initialScene, mark: null } : null);
  const [bossResult, setBossResult] = useState<BossOutcome["battle"] | null>(initialBoss ?? null);
  const autoShown = useRef<string>("");
  const markSeen = useMarkSeen();
  const push = useUiStore((st) => st.pushToast);
  const toasted = useRef("");

  // Play an unwatched scene once when it appears.
  useEffect(() => {
    if (!autoplay || !s.pendingScene) return;
    const key = `${s.pendingScene.chapter}:${s.pendingScene.scene}`;
    if (autoShown.current === key) return;
    const ch = s.chapters.find((c) => c.code === s.pendingScene!.chapter);
    const view = s.pendingScene.scene === "intro" ? ch?.intro : ch?.outro;
    if (!view) return;
    autoShown.current = key;
    setScene({ view, mark: s.pendingScene });
  }, [s.pendingScene, s.chapters, autoplay]);

  useEffect(() => {
    const key = s.newAchievements.join("|");
    if (!key || toasted.current === key) return;
    toasted.current = key;
    for (const code of s.newAchievements) {
      const a = s.achievements.find((x) => x.code === code);
      if (a) push("level", `Достижение: «${a.name}»`);
    }
  }, [s.newAchievements, s.achievements, push]);

  const closeScene = () => {
    const mark = scene?.mark;
    setScene(null);
    if (mark) markSeen.mutate(mark);
  };

  const unlocked = s.achievements.filter((a) => a.unlocked).length;

  return (
    <div className="grid gap-4">
      {scene && <Cutscene key={scene.view.code} scene={scene.view} onDone={closeScene} />}
      {bossResult && <BossResult r={bossResult} onClose={() => setBossResult(null)} />}

      <section className="pixel-panel pixel-panel-gold p-4" aria-label="Хроники">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="font-display text-2xl text-gold">Хроники королевства</h1>
          <span className="text-sm text-muted">
            {s.activeTitle ? `${s.heroName}, «${s.activeTitle.name}»` : s.heroName} · достижений {unlocked}/{s.achievements.length}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4" role="tablist" aria-label="Разделы хроник">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={`pixel-btn px-2 text-xs sm:text-sm ${tab === t.id ? "border-gold text-gold" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </section>

      {tab === "story" && <StoryTab s={s} onScene={(view) => setScene({ view, mark: null })} onBoss={setBossResult} />}
      {tab === "achievements" && <AchievementsTab s={s} />}
      {tab === "titles" && <TitlesTab s={s} />}
      {tab === "history" && <HistoryTab s={s} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Story
// ---------------------------------------------------------------------------
function StoryTab({ s, onScene, onBoss }: { s: StoryScreen; onScene: (v: SceneView) => void; onBoss: (r: BossOutcome["battle"]) => void }) {
  const c = s.current;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="grid content-start gap-4 lg:col-span-2">
        {c ? (
          <>
            <section className="pixel-panel overflow-hidden" aria-label={`Глава ${c.number}`}>
              <div className="relative h-28 sm:h-36">
                <StoryBackdrop kind={c.intro.backdrop} className="absolute inset-0 h-full w-full" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" aria-hidden />
                <div className="absolute bottom-2 left-3 right-3">
                  <div className="font-display text-xs text-gold">
                    Глава {c.number} · {STAGE_LABEL[c.stage]}
                  </div>
                  <h2 className="font-display text-xl text-white">{c.title}</h2>
                </div>
              </div>
              <div className="p-4">
                <p className="text-sm text-text/90">{c.summary}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button className={`pixel-btn text-sm ${c.stage === "intro" ? "pixel-btn-gold" : ""}`} onClick={() => onScene(c.intro)}>
                    ▶ {c.stage === "intro" ? "Начать главу" : `Сцена «${c.intro.title}»`}
                  </button>
                </div>
              </div>
            </section>

            {c.stage !== "intro" && (
              <>
                <Objectives c={c} />
                <Decision c={c} />
                {c.boss && <Boss c={c} s={s} onBoss={onBoss} />}
                <Complete c={c} />
              </>
            )}
          </>
        ) : (
          <section className="pixel-panel pixel-panel-gold p-6 text-center">
            <div className="text-3xl" aria-hidden>
              📖
            </div>
            <h2 className="mt-2 font-display text-xl text-gold">Первая книга пройдена</h2>
            <p className="mt-1 text-sm text-text/90">Соперничество двух наследников продолжится в следующих книгах. А пока королевство живёт вашими реальными делами.</p>
          </section>
        )}
      </div>

      <section className="pixel-panel content-start p-4" aria-label="Главы">
        <h2 className="font-display text-gold">Главы первой книги</h2>
        <ol className="mt-2 grid gap-3">
          {s.chapters.map((ch) => (
            <ChapterRow key={ch.code} ch={ch} onScene={onScene} />
          ))}
        </ol>
      </section>
    </div>
  );
}

function Objectives({ c }: { c: ChapterView }) {
  const done = c.objectives.filter((o) => o.done).length;
  return (
    <section className="pixel-panel p-4" aria-label="Цели главы">
      <div className="flex items-baseline justify-between">
        <h3 className="font-display text-gold">Цели главы</h3>
        <span className="font-display text-sm text-muted">
          {done}/{c.objectives.length}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted">Прогресс берётся из реальной игры: задания, стройка, бои и двор.</p>
      <ul className="mt-2 grid gap-2">
        {c.objectives.map((o) => (
          <li key={o.code} className="grid gap-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className={o.done ? "text-xp" : ""}>
                {o.done ? "✓ " : "○ "}
                {o.label}
              </span>
              <span className="font-display text-xs text-muted">
                {o.current}/{o.target}
              </span>
            </div>
            <div className="xp-bar" role="progressbar" aria-valuemin={0} aria-valuemax={o.target} aria-valuenow={o.current} aria-label={o.label}>
              <span style={{ width: `${Math.round((o.current / o.target) * 100)}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Decision({ c }: { c: ChapterView }) {
  const choose = useStoryChoose();
  const [result, setResult] = useState<{ text: string; effects: string[] } | null>(null);
  const d = c.decision;
  return (
    <section className="pixel-panel overflow-hidden" aria-label="Решение главы">
      <div className="relative h-20">
        <StoryBackdrop kind={d.backdrop} className="absolute inset-0 h-full w-full" />
        <div className="absolute inset-0 bg-black/45" aria-hidden />
        <h3 className="absolute bottom-2 left-4 font-display text-gold">⚖️ {d.title}</h3>
      </div>
      <div className="p-4">
        <p className="text-sm">{d.text}</p>
        {d.chosen ? (
          <div className="mt-3 border-2 border-gold-dim bg-bg-deep p-3 anim-rise">
            <div className="font-display text-sm text-gold">Ваше решение: {d.chosen.label}</div>
            <p className="mt-1 text-sm text-text/90">{result?.text ?? d.chosen.text}</p>
            {result && result.effects.length > 0 && <p className="mt-1 text-xs text-muted">{result.effects.join(" · ")}</p>}
          </div>
        ) : (
          <div className="mt-3 grid gap-2">
            {d.choices.map((ch) => (
              <button
                key={ch.code}
                className="pixel-btn text-left text-sm"
                disabled={!!ch.blocked || choose.isPending}
                title={ch.blocked ?? undefined}
                onClick={() =>
                  choose.mutate(
                    { chapter: c.code, choice: ch.code },
                    { onSuccess: (r) => r.outcome && setResult({ text: r.outcome.text, effects: r.outcome.effects }) },
                  )
                }
              >
                <span className="block">{ch.label}</span>
                <span className="block text-xs text-muted">{ch.blocked ?? (ch.effects.length ? ch.effects.join(" · ") : "Без затрат")}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function Boss({ c, s, onBoss }: { c: ChapterView; s: StoryScreen; onBoss: (r: BossOutcome["battle"]) => void }) {
  const b = c.boss!;
  const attack = useBoss();
  const [tactic, setTactic] = useState<Tactic>("balanced");
  const [commander, setCommander] = useState<"self" | "general">(s.general && s.general.skill > s.heroStrategy ? "general" : "self");
  const risk = estimateRisk({
    army: s.army.units,
    morale: s.army.morale,
    commander,
    strategy: commander === "general" && s.general ? s.general.skill : s.heroStrategy,
    tactic,
    powerBonus: s.powerBonus,
    target: b.target,
  });
  const winChance = Math.round(risk.winChance * 100);
  const rs = RISK[risk.level];

  return (
    <section className={`pixel-panel p-4 ${c.stage === "boss" ? "border-danger" : ""}`} aria-label="Сюжетный босс">
      <div className="flex gap-3">
        <SpeakerPortrait speaker={b.speaker} name={b.name} size={72} />
        <div className="min-w-0">
          <h3 className="font-display text-lg text-danger">{b.name}</h3>
          <div className="text-xs text-muted">{b.title}</div>
          <p className="mt-1 text-sm">{b.text}</p>
        </div>
      </div>
      {b.defeated ? (
        <p className="mt-3 font-display text-xp">✓ Повержен{b.attempts > 1 ? ` с ${b.attempts}-й попытки` : ""}.</p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 text-center text-sm">
            <div className="border-2 border-border bg-bg-deep p-2">
              <div className="text-xs text-muted">Ваша сила</div>
              <div className="font-display text-lg text-xp">{Math.round(risk.attackerPower)}</div>
            </div>
            <div className="border-2 border-border bg-bg-deep p-2">
              <div className="text-xs text-muted">Сила врага</div>
              <div className="font-display text-lg text-danger">{Math.round(b.risk.defenderPower)}</div>
            </div>
          </div>
          <p className={`mt-2 text-center font-display text-sm ${rs.cls}`}>
            {rs.label}: шанс победы ≈ {winChance}%
            {s.powerBonus > 0 ? ` (реликвии +${Math.round(s.powerBonus * 100)}%)` : ""}
          </p>
          <div className="mt-2 grid grid-cols-3 gap-1">
            {(Object.keys(TACTICS) as Tactic[]).map((x) => (
              <button key={x} className={`pixel-btn px-1 text-xs ${tactic === x ? "border-gold text-gold" : ""}`} aria-pressed={tactic === x} onClick={() => setTactic(x)}>
                {TACTICS[x].name}
              </button>
            ))}
          </div>
          {s.general && (
            <div className="mt-1 grid grid-cols-2 gap-1">
              <button className={`pixel-btn px-1 text-xs ${commander === "self" ? "border-gold text-gold" : ""}`} aria-pressed={commander === "self"} onClick={() => setCommander("self")}>
                Лично (Стратегия {s.heroStrategy})
              </button>
              <button className={`pixel-btn px-1 text-xs ${commander === "general" ? "border-gold text-gold" : ""}`} aria-pressed={commander === "general"} onClick={() => setCommander("general")}>
                {s.general.name.split(" ")[0]} ({s.general.skill})
              </button>
            </div>
          )}
          <p className="mt-2 text-xs text-muted">
            Армия:{" "}
            {UNIT_TYPES.filter((u) => (s.army.units[u] ?? 0) > 0)
              .map((u) => `${UNITS[u].icon}${s.army.units[u]}`)
              .join(" ") || "нет войск"}{" "}
            · 🚩 {s.army.commandPoints} · награда: {[...b.rewards, ...(b.item ? [`${b.item.icon} ${b.item.name}`] : [])].join(", ")}
          </p>
          <button
            className="pixel-btn pixel-btn-gold mt-3 w-full"
            disabled={!!b.blocked || attack.isPending}
            onClick={() => attack.mutate({ chapter: c.code, tactic, commander }, { onSuccess: (r) => r.battle && onBoss(r.battle) })}
          >
            {attack.isPending ? "Бой идёт…" : "⚔️ Штурм"}
          </button>
          {b.blocked && <p className="mt-1 text-center text-xs text-muted">{b.blocked}</p>}
        </>
      )}
    </section>
  );
}

function Complete({ c }: { c: ChapterView }) {
  const complete = useCompleteChapter();
  const push = useUiStore((st) => st.pushToast);
  const ready = c.stage === "ready";
  return (
    <section className={`pixel-panel p-4 ${ready ? "pixel-panel-gold anim-pulse" : ""}`} aria-label="Финал главы">
      <h3 className="font-display text-gold">🏁 Награда за главу</h3>
      <p className="mt-1 text-sm">{c.rewards.join(" · ")}</p>
      <p className="mt-1 text-xs text-muted">Сюжет даёт ресурсы, реликвии и титулы. Опыт приходит только из реальных заданий.</p>
      <button
        className="pixel-btn pixel-btn-gold mt-3 w-full"
        disabled={!ready || complete.isPending}
        onClick={() => complete.mutate({ chapter: c.code }, { onSuccess: (r) => r.rewards.length && push("success", `Глава пройдена: ${r.rewards.join(", ")}`) })}
      >
        {ready ? "Завершить главу" : c.boss && !c.boss.defeated ? "Сначала победите босса" : "Выполните цели и примите решение"}
      </button>
    </section>
  );
}

function ChapterRow({ ch, onScene }: { ch: StoryScreen["chapters"][number]; onScene: (v: SceneView) => void }) {
  const chronicle = useChronicle();
  const [open, setOpen] = useState(false);
  const icon = ch.status === "completed" ? "✅" : ch.status === "active" ? "📖" : "🔒";
  return (
    <li className={`border-2 p-3 ${ch.status === "active" ? "border-gold-dim" : "border-border"} ${ch.status === "locked" ? "opacity-60" : ""}`}>
      <div className="font-display text-sm">
        {icon} Глава {ch.number}. {ch.title}
      </div>
      <p className="text-xs text-muted">{ch.status === "locked" ? "Откроется после предыдущей главы." : ch.summary}</p>
      {ch.decision && <p className="mt-1 text-xs">Решение: {ch.decision}</p>}
      {(ch.intro || ch.outro) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {ch.intro && (
            <button className="pixel-btn px-2 text-xs" onClick={() => onScene(ch.intro!)}>
              ▶ Пролог
            </button>
          )}
          {ch.outro && (
            <button className="pixel-btn px-2 text-xs" onClick={() => onScene(ch.outro!)}>
              ▶ Эпилог
            </button>
          )}
          {ch.status === "completed" && (
            <button
              className="pixel-btn px-2 text-xs"
              disabled={chronicle.isPending}
              onClick={() => {
                setOpen(true);
                if (!ch.chronicle) chronicle.mutate({ chapter: ch.code });
              }}
            >
              📜 Летопись
            </button>
          )}
        </div>
      )}
      {open && ch.status === "completed" && (
        <blockquote className="mt-2 border-l-4 border-gold-dim bg-bg-deep p-2 text-sm italic anim-rise">
          {ch.chronicle ?? (chronicle.isPending ? "Летописец пишет…" : "Летопись пока недоступна.")}
          {ch.chronicle && <span className="mt-1 block text-[10px] not-italic text-muted">{ch.chronicleSource === "AI" ? "Записано летописцем (AI)" : "Из королевского архива"}</span>}
        </blockquote>
      )}
    </li>
  );
}

function BossResult({ r, onClose }: { r: NonNullable<BossOutcome["battle"]>; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/70 p-4 anim-fade" role="dialog" aria-modal="true" aria-label="Итог боя">
      <div className={`pixel-panel w-full max-w-md p-5 text-center ${r.win ? "pixel-panel-gold anim-pop" : "border-danger anim-shake"}`}>
        <div className="text-4xl" aria-hidden>
          {r.win ? "🏆" : "🛡️"}
        </div>
        <h2 className={`mt-2 font-display text-xl ${r.win ? "text-gold" : "text-danger"}`}>{r.win ? `${r.name} повержен!` : "Штурм отбит"}</h2>
        <p className="mt-2 text-sm">{r.text}</p>
        <p className="mt-2 text-xs text-muted">
          Сила: {Math.round(r.attackerPower)} против {Math.round(r.defenderPower)} · тактика «{TACTICS[r.tactic].name}»
        </p>
        {Object.keys(r.casualties).length > 0 && (
          <p className="mt-1 text-xs text-muted">
            Потери:{" "}
            {UNIT_TYPES.filter((u) => r.casualties[u])
              .map((u) => `${UNITS[u].icon}${r.casualties[u]}`)
              .join(" ")}
          </p>
        )}
        {r.rewards.length > 0 && <p className="mt-2 font-display text-sm text-xp">{r.rewards.join(" · ")}</p>}
        <button className="pixel-btn pixel-btn-gold mt-4 w-full" onClick={onClose} autoFocus>
          Дальше
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Achievements, titles, items, history
// ---------------------------------------------------------------------------
function AchievementsTab({ s }: { s: StoryScreen }) {
  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Достижения">
      {s.achievements.map((a) => (
        <div key={a.code} className={`pixel-panel flex gap-3 p-3 ${a.unlocked ? "border-gold-dim" : "opacity-70"}`}>
          <div className={`text-3xl ${a.unlocked ? "" : "grayscale"}`} aria-hidden>
            {a.unlocked ? a.icon : "🔒"}
          </div>
          <div className="min-w-0 flex-1">
            <div className={`font-display text-sm ${a.unlocked ? "text-gold" : ""}`}>{a.name}</div>
            <p className="text-xs text-muted">{a.description}</p>
            {a.title && <p className="text-[11px] text-gold/80">Титул «{a.title}»</p>}
            {a.unlocked ? (
              <p className="mt-1 text-[11px] text-xp">✓ {a.unlockedAt ? formatWhen(a.unlockedAt) : "получено"}</p>
            ) : (
              <div className="mt-1 xp-bar" role="progressbar" aria-valuemin={0} aria-valuemax={a.progress.target} aria-valuenow={a.progress.current} aria-label={a.name}>
                <span style={{ width: `${Math.round((a.progress.current / a.progress.target) * 100)}%` }} />
              </div>
            )}
          </div>
        </div>
      ))}
    </section>
  );
}

function TitlesTab({ s }: { s: StoryScreen }) {
  const setTitle = useSetTitle();
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="pixel-panel p-4" aria-label="Титулы">
        <h2 className="font-display text-gold">Титулы</h2>
        <p className="text-xs text-muted">Активный титул виден в Тронном зале.</p>
        <ul className="mt-2 grid gap-2">
          {s.titles.map((t) => (
            <li key={t.code} className={`flex items-center justify-between gap-2 border-2 p-2 ${t.active ? "border-gold" : "border-border"} ${t.unlocked ? "" : "opacity-60"}`}>
              <div className="min-w-0">
                <div className={`font-display text-sm ${t.unlocked ? "text-gold" : ""}`}>{t.unlocked ? `«${t.name}»` : "🔒 ???"}</div>
                <div className="text-xs text-muted">{t.source}</div>
              </div>
              {t.unlocked && (
                <button className="pixel-btn shrink-0 px-2 text-xs" disabled={setTitle.isPending} onClick={() => setTitle.mutate({ title: t.active ? null : t.code })}>
                  {t.active ? "Снять" : "Выбрать"}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
      <section className="pixel-panel p-4" aria-label="Реликвии">
        <h2 className="font-display text-gold">Реликвии</h2>
        <p className="text-xs text-muted">Предметы из глав и побед над боссами. Действуют постоянно.</p>
        <ul className="mt-2 grid gap-2">
          {s.items.map((i) => (
            <li key={i.code} className={`flex gap-3 border-2 p-2 ${i.owned ? "border-gold-dim" : "border-border opacity-60"}`}>
              <span className={`text-2xl ${i.owned ? "anim-bob" : "grayscale"}`} aria-hidden>
                {i.owned ? i.icon : "❔"}
              </span>
              <div className="min-w-0">
                <div className={`font-display text-sm ${i.owned ? "text-gold" : ""}`}>{i.owned ? i.name : "Неизвестная реликвия"}</div>
                <p className="text-xs text-muted">{i.owned ? i.description : "Её ещё предстоит найти в сюжете."}</p>
                {i.owned && <p className="text-xs text-xp">{i.effect}</p>}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

const CATEGORIES: { id: TimelineCategory | "all"; label: string }[] = [
  { id: "all", label: "Всё" },
  { id: "kingdom", label: "Королевство" },
  { id: "battles", label: "Битвы" },
  { id: "politics", label: "Политика" },
  { id: "rivalry", label: "Соперничество" },
  { id: "story", label: "Сюжет" },
];

function HistoryTab({ s }: { s: StoryScreen }) {
  const [cat, setCat] = useState<TimelineCategory | "all">("all");
  const items = s.timeline.filter((t) => cat === "all" || t.category === cat);
  return (
    <section className="pixel-panel p-4" aria-label="История королевства">
      <div className="flex flex-wrap gap-1">
        {CATEGORIES.map((c) => (
          <button key={c.id} className={`pixel-btn px-2 text-xs ${cat === c.id ? "border-gold text-gold" : ""}`} aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>
            {c.label}
          </button>
        ))}
      </div>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-muted">В этом разделе пока нет записей.</p>
      ) : (
        <ol className="mt-3 grid gap-2 border-l-2 border-border pl-3">
          {items.map((t) => (
            <li key={t.id} className="text-sm">
              <span className="text-xs text-muted">{formatWhen(t.at)} · </span>
              {t.text}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
