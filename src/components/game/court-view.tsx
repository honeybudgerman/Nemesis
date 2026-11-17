"use client";

import { useEffect, useRef, useState } from "react";
import { CourtPortrait } from "@/components/characters/court-portrait";
import { POSITION_DEFS, ROLE_LABELS, SKILL_LABELS_NPC, SKILLS, STAT_LABELS, STATUS_LABELS, NPC_STATS, type NpcStat, type RelationshipStatus } from "@/data/court/npcs";
import { useAssign, useChoose, useCourt, useInteract, useNpc, useStartPersonalQuest } from "@/hooks/use-court";
import type { CourtEventView, CourtScreen, NpcCard, NpcDetail, OutcomeView } from "@/types/court";

const STAT_COLOR: Record<NpcStat, string> = {
  loyalty: "var(--gold)",
  affection: "#e07a9a",
  trust: "var(--xp)",
  ambition: "var(--rival)",
  jealousy: "var(--danger)",
  influence: "var(--mana)",
};

const STATUS_STYLE: Record<RelationshipStatus, string> = {
  STRANGERS: "text-muted border-border",
  ACQUAINTED: "text-text border-border",
  FRIENDS: "text-xp border-xp-dim",
  CLOSE: "text-xp border-xp",
  ROMANCE: "text-[#f29ab4] border-[#b5557a]",
  PARTNER: "text-[#f29ab4] border-[#f29ab4]",
  BROKEN: "text-danger border-danger",
};

const KIND_LABEL = { quest: "Личный квест", intrigue: "Интрига", politics: "Политика" } as const;
const RES_ICON = { gold: "🪙", food: "🌾", knowledge: "📘", influence: "🎖️" } as const;

export function CourtView() {
  const { data, error, isPending, refetch } = useCourt();
  if (isPending) return <div className="py-16 text-center font-display text-muted">Придворные собираются в тронном зале…</div>;
  if (!data) {
    return (
      <div className="pixel-panel p-6 text-center">
        <p className="text-danger">{error instanceof Error ? error.message : "Не удалось загрузить двор."}</p>
        <button className="pixel-btn mt-4" onClick={() => refetch()}>
          Повторить
        </button>
      </div>
    );
  }
  return <CourtScreenView s={data} />;
}

export function CourtScreenView({
  s,
  initialSelected,
  initialOutcome,
  previewDetail,
}: {
  s: CourtScreen;
  initialSelected?: string;
  initialOutcome?: OutcomeView;
  previewDetail?: NpcDetail;
}) {
  const [selected, setSelected] = useState<string>(initialSelected ?? s.npcs.find((n) => n.recruited)?.code ?? "liara");
  const [outcome, setOutcome] = useState<OutcomeView | null>(initialOutcome ?? null);
  const detailRef = useRef<HTMLDivElement>(null);
  const pick = (code: string) => {
    setSelected(code);
    if (typeof window !== "undefined" && window.innerWidth < 1024) setTimeout(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };
  const bonus = (Object.keys(s.dailyBonus) as (keyof typeof s.dailyBonus)[]).filter((k) => s.dailyBonus[k] > 0);

  return (
    <div className="grid gap-4">
      <section className="pixel-panel pixel-panel-gold p-4" aria-label="Двор">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="font-display text-2xl text-gold">Королевский двор</h1>
          <div className="text-sm text-muted">
            Должности приносят: {bonus.length ? bonus.map((k) => `${RES_ICON[k]} +${s.dailyBonus[k]}`).join(" ") : "пока ничего"} в день
          </div>
        </div>
        <p className="mt-1 text-sm text-text/90">
          У каждого придворного свои цели и характер. Ваши решения меняют их отношение к вам и друг к другу, а события двора влияют на казну, армию и границы.
        </p>
      </section>

      {outcome && <OutcomeCard o={outcome} onClose={() => setOutcome(null)} />}
      {s.events.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {s.events.map((e) => (
            <EventCard key={e.id} e={e} onOutcome={setOutcome} />
          ))}
        </div>
      ) : (
        !outcome && <p className="pixel-panel p-3 text-sm text-muted">Сегодня при дворе спокойно. Новые события появляются не чаще раза в день.</p>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        <section className="lg:col-span-3" aria-label="Придворные">
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-4">
            {s.npcs.map((n) => (
              <li key={n.code}>
                <NpcTile n={n} active={n.code === selected} onClick={() => pick(n.code)} />
              </li>
            ))}
          </ul>
        </section>
        <div ref={detailRef} className="scroll-mt-4 lg:col-span-2">
          <NpcPanel code={selected} card={s.npcs.find((n) => n.code === selected)!} preview={previewDetail?.card.code === selected ? previewDetail : undefined} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <PositionsPanel s={s} />
        <HistoryPanel s={s} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
function EventCard({ e, onOutcome }: { e: CourtEventView; onOutcome: (o: OutcomeView) => void }) {
  const choose = useChoose();
  return (
    <section id={`court-event-${e.code}`} tabIndex={-1} className="pixel-panel scroll-mt-24 p-4" aria-label={e.title} style={{ borderColor: e.kind === "quest" ? "var(--gold-dim)" : e.kind === "intrigue" ? "var(--rival)" : "var(--mana)" }}>
      <div className="text-xs uppercase tracking-wide text-muted">{KIND_LABEL[e.kind]}</div>
      <h2 className="font-display text-xl text-gold">{e.title}</h2>
      <div className="mt-2 flex gap-3">
        <div className="flex shrink-0 -space-x-3">
          {e.participants.slice(0, 3).map((p) => (
            <CourtPortrait key={p.code} code={p.code} size={40} title={p.name} />
          ))}
        </div>
        <p className="text-sm leading-relaxed">{e.text}</p>
      </div>
      <ul className="mt-3 grid gap-2">
        {e.choices.map((c) => (
          <li key={c.code}>
            <button
              className="pixel-btn w-full text-left text-sm"
              disabled={!!c.blocked || choose.isPending}
              onClick={() => choose.mutate({ eventId: e.id, choice: c.code }, { onSuccess: (r) => r.outcome && onOutcome(r.outcome) })}
            >
              <span>{c.label}</span>
              {Object.keys(c.cost).length > 0 && (
                <span className="ml-2 text-xs text-muted">
                  {(Object.keys(c.cost) as (keyof typeof RES_ICON)[]).map((k) => `${RES_ICON[k]} ${c.cost[k]}`).join(" ")}
                </span>
              )}
              {c.hint && <span className="ml-2 text-xs text-muted">· {c.hint}</span>}
              {c.blocked && <span className="block text-xs text-danger">{c.blocked}</span>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function OutcomeCard({ o, onClose }: { o: OutcomeView; onClose: () => void }) {
  return (
    <section className="pixel-panel pixel-panel-gold p-4" aria-live="polite" aria-label="Итог решения">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs text-muted">{o.title}</div>
          <h2 className="font-display text-lg text-gold">{o.choice}</h2>
        </div>
        <button className="pixel-btn px-3 text-sm" onClick={onClose} aria-label="Закрыть итог">
          ✕
        </button>
      </div>
      <p className="mt-2 text-sm leading-relaxed">{o.text}</p>
      {o.effects.length > 0 && (
        <ul className="mt-2 grid gap-0.5 text-xs text-muted">
          {o.effects.map((x) => (
            <li key={x}>• {x}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------
function NpcTile({ n, active, onClick }: { n: NpcCard; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`pixel-panel flex h-full w-full flex-col items-center gap-1 p-2 text-center ${active ? "pixel-panel-gold" : ""}`}
      style={active ? { outline: "2px solid var(--gold)", outlineOffset: -2 } : undefined}
    >
      <CourtPortrait code={n.code} size={56} title={n.name} dim={!n.recruited} />
      <span className="font-display text-sm leading-tight">{n.name}</span>
      <span className="text-[11px] leading-tight text-muted">{n.recruited ? ROLE_LABELS[n.role] : "Ещё не при дворе"}</span>
      {n.recruited && (
        <>
          <span className={`border px-1 text-[10px] leading-4 ${STATUS_STYLE[n.status]}`}>{STATUS_LABELS[n.status]}</span>
          <span className="grid w-full gap-0.5">
            <MiniBar stat="loyalty" v={n.stats.loyalty} />
            <MiniBar stat="affection" v={n.stats.affection} />
            <MiniBar stat="trust" v={n.stats.trust} />
          </span>
          <span className="text-[10px] text-muted">
            {n.position ? `${POSITION_DEFS[n.position].icon} ${POSITION_DEFS[n.position].name}` : ""}
            {n.quest ? `${n.position ? " · " : ""}квест ${n.quest.done}/${n.quest.total}` : ""}
            {n.interactedToday ? " · ✓" : ""}
          </span>
        </>
      )}
    </button>
  );
}

function MiniBar({ stat, v }: { stat: NpcStat; v: number }) {
  return (
    <span className="block h-1.5 w-full bg-bg-deep" title={`${STAT_LABELS[stat]}: ${v}`}>
      <span className="block h-full" style={{ width: `${v}%`, background: STAT_COLOR[stat] }} />
    </span>
  );
}

function NpcPanel({ code, card, preview }: { code: string; card: NpcCard; preview?: NpcDetail }) {
  const q = useNpc(preview ? null : code);
  const d = preview ?? q.data;
  const interact = useInteract();
  const startQuest = useStartPersonalQuest();
  const [line, setLine] = useState<{ content: string; source: "AI" | "FALLBACK" } | null>(null);
  useEffect(() => setLine(null), [code]);
  const c = d?.card ?? card;

  return (
    <section className="pixel-panel p-4" aria-label={c.name}>
      <div className="flex gap-3">
        <CourtPortrait code={c.code} size={88} title={c.name} dim={!c.recruited} />
        <div className="min-w-0">
          <h2 className="font-display text-xl leading-tight">{c.name}</h2>
          <div className="text-sm text-muted">
            {c.title}, {c.age} лет
          </div>
          {c.recruited ? (
            <div className="mt-1 flex flex-wrap gap-1 text-xs">
              <span className={`border px-1 ${STATUS_STYLE[c.status]}`}>{STATUS_LABELS[c.status]}</span>
              {c.position && <span className="border border-gold-dim px-1 text-gold">{POSITION_DEFS[c.position].name}</span>}
            </div>
          ) : (
            <p className="mt-1 text-xs text-muted">{c.joinHint}</p>
          )}
        </div>
      </div>

      {c.recruited && (
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          {NPC_STATS.map((k) => (
            <div key={k}>
              <div className="flex justify-between">
                <dt className="text-muted">{STAT_LABELS[k]}</dt>
                <dd className="font-display">{c.stats[k]}</dd>
              </div>
              <span className="block h-2 w-full border border-border bg-bg-deep">
                <span className="block h-full" style={{ width: `${c.stats[k]}%`, background: STAT_COLOR[k] }} />
              </span>
            </div>
          ))}
        </dl>
      )}

      {!d ? (
        <p className="mt-3 text-sm text-muted">{q.isError ? "Не удалось загрузить подробности." : "Загружаю…"}</p>
      ) : (
        <>
          {c.recruited && (
            <>
              <div className="mt-3 grid grid-cols-2 gap-1 sm:grid-cols-4">
                {d.interactions.map((a) => (
                  <button
                    key={a.action}
                    className="pixel-btn px-1 text-xs"
                    disabled={!!a.blocked || interact.isPending}
                    title={a.blocked ?? a.description}
                    onClick={() => interact.mutate({ npcCode: c.code, action: a.action }, { onSuccess: (r) => setLine(r.line) })}
                  >
                    {a.icon} {a.name}
                    {a.cost ? ` · 🪙${a.cost}` : ""}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-muted">
                {c.interactedToday ? "Сегодня вы уже уделили время этому персонажу. Возвращайтесь завтра." : "Одно действие с каждым персонажем в день."}
              </p>
            </>
          )}

          {(line || d.messages.length > 0) && (
            <div className="mt-3 grid gap-2">
              {(line ? [...d.messages.filter((m) => m.content !== line.content).slice(-2), { id: "now", content: line.content, source: line.source }] : d.messages.slice(-3)).map((m) => (
                <blockquote key={m.id} className="border-l-4 border-gold-dim bg-bg-deep px-2 py-1 text-sm italic">
                  {m.content}
                  {m.source === "AI" && <span className="ml-1 not-italic text-[10px] text-mana">✦</span>}
                </blockquote>
              ))}
            </div>
          )}

          <p className="mt-3 text-sm leading-relaxed">{d.bio}</p>
          <p className="mt-1 text-sm">
            <span className="text-muted">Цели: </span>
            {d.goals}
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {d.traits.map((t) => (
              <span key={t} className="border border-border px-1.5 text-xs text-muted">
                {t}
              </span>
            ))}
          </div>

          {d.quests.length > 0 && (
            <>
              <h3 className="mt-4 font-display text-gold">Личный квест</h3>
              <ol className="mt-1 grid gap-1 text-sm">
                {d.quests.map((s) => (
                  <li key={s.code} className="flex gap-2">
                    <span aria-hidden>{s.state === "done" ? "✅" : s.state === "open" ? "📜" : s.state === "ready" ? "⏳" : "🔒"}</span>
                    <span className="min-w-0">
                      <span className={s.state === "locked" ? "text-muted" : ""}>{s.title}</span>
                      {s.choice && <span className="block text-xs text-muted">Решение: {s.choice}</span>}
                      {s.state === "open" && <a className="block text-xs text-gold underline" href={`#court-event-${s.code}`}>Перейти к решению</a>}
                      {s.state === "ready" && (
                        <button type="button" className="pixel-btn mt-1 text-xs" disabled={!!preview || startQuest.isPending}
                          onClick={() => startQuest.mutate(s.code, { onSuccess: () => {
                            requestAnimationFrame(() => {
                              const event = document.getElementById(`court-event-${s.code}`);
                              event?.focus({ preventScroll: true });
                              event?.scrollIntoView({ block: "start" });
                            });
                          } })}
                        >
                          {startQuest.isPending && startQuest.variables === s.code ? "Открываем…" : "Начать личный квест"}
                        </button>
                      )}
                      {s.hint && <span className="block text-xs text-muted">{s.hint}</span>}
                    </span>
                  </li>
                ))}
              </ol>
            </>
          )}

          {d.relations.length > 0 && (
            <>
              <h3 className="mt-4 font-display text-gold">Отношения при дворе</h3>
              <ul className="mt-1 grid gap-1 text-xs">
                {d.relations.map((r) => (
                  <li key={r.code} className="flex items-center gap-2">
                    <span className="w-28 shrink-0 truncate text-sm">{r.name}</span>
                    <span className="text-muted">
                      симпатия {r.affinity} · соперничество {r.rivalry} · доверие {r.trust}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

          <h3 className="mt-4 font-display text-gold">Умения</h3>
          <dl className="mt-1 grid grid-cols-2 gap-x-3 text-xs sm:grid-cols-3">
            {SKILLS.map((k) => (
              <div key={k} className="flex justify-between">
                <dt className="text-muted">{SKILL_LABELS_NPC[k]}</dt>
                <dd className="font-display">{d.skills[k]}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Positions and history
// ---------------------------------------------------------------------------
function PositionsPanel({ s }: { s: CourtScreen }) {
  const assign = useAssign();
  return (
    <section className="pixel-panel p-4" aria-label="Должности">
      <h2 className="font-display text-gold">Должности</h2>
      <p className="text-xs text-muted">Назначение радует избранного, а честолюбивые соперники запомнят, что их обошли.</p>
      <ul className="mt-2 grid gap-2">
        {s.positions.map((p) => (
          <li key={p.position} className="border-2 border-border bg-bg-deep p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">
                {p.icon} {p.name}
              </span>
              <select
                className="pixel-input max-w-[55%] py-1 text-sm"
                value={p.holder ?? ""}
                disabled={assign.isPending}
                aria-label={`Назначить: ${p.name}`}
                onChange={(e) => assign.mutate({ position: p.position, npcCode: e.target.value || null })}
              >
                <option value="">— никого —</option>
                {p.candidates.map((c) => (
                  <option key={c.code} value={c.code} disabled={!!c.blocked && c.code !== p.holder}>
                    {c.name}
                    {c.blocked && c.code !== p.holder ? " (нет при дворе)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="mt-1 text-xs text-muted">{p.bonus ?? p.effect}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function HistoryPanel({ s }: { s: CourtScreen }) {
  return (
    <section className="pixel-panel p-4" aria-label="Решения двора">
      <h2 className="font-display text-gold">Решения двора</h2>
      {s.history.length === 0 ? (
        <p className="mt-1 text-sm text-muted">Пока ни одного решения. Поговорите с придворными: так начинаются их истории.</p>
      ) : (
        <ul className="mt-2 grid gap-2 text-sm">
          {s.history.map((h) => (
            <li key={h.code} className="border-l-4 border-gold-dim pl-2">
              <div className="flex justify-between gap-2">
                <span className="font-semibold">{h.title}</span>
                <span className="shrink-0 text-xs text-muted">{new Date(h.day).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}</span>
              </div>
              <div className="text-xs text-gold">{h.choice}</div>
              {h.text && <div className="text-xs text-muted">{h.text}</div>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
