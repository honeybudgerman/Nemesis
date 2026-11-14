"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { RESOURCE_LABELS } from "@/data/kingdom";
import { BUILDINGS } from "@/data/realm/buildings";
import { TERRAIN_DEFENSE, TERRAIN_LABELS, type Terrain, type TerritoryOwner, type TerritoryResource } from "@/data/realm/map";
import { TACTICS, UNIT_TYPES, UNITS, type Tactic } from "@/data/realm/units";
import { estimateRisk, type Army } from "@/engine/realm/battle";
import { KINGDOM_KEY, useAttack, useBuild, useKingdom, useKingdomCatchUp, useRecruit, type AttackResponse } from "@/hooks/use-kingdom";
import { createSeededRandom, hashString } from "@/lib/random";
import type { KingdomScreen, RecruitOption, TerritoryView } from "@/types/realm";

const OWNER: Record<TerritoryOwner, { label: string; color: string; text: string }> = {
  HERO: { label: "Ваши земли", color: "var(--gold)", text: "text-gold" },
  RIVAL: { label: "Каэль", color: "var(--rival)", text: "text-rival" },
  NEUTRAL: { label: "Нейтральные", color: "#8a8296", text: "text-muted" },
  FACTION: { label: "Фракция", color: "var(--mana)", text: "text-mana" },
};

const RES_ICON: Record<TerritoryResource, string> = { gold: "🪙", food: "🌾", knowledge: "📘", influence: "🎖️" };

export function KingdomView() {
  const { data, error, isPending, refetch } = useKingdom();
  useKingdomCatchUp(data?.pendingDays ?? 0);
  if (isPending) return <div className="py-16 text-center font-display text-muted">Картографы раскладывают карту…</div>;
  if (!data) {
    return (
      <div className="pixel-panel p-6 text-center">
        <p className="text-danger">{error instanceof Error ? error.message : "Не удалось загрузить королевство."}</p>
        <button className="pixel-btn mt-4" onClick={() => refetch()}>
          Повторить
        </button>
      </div>
    );
  }
  return <KingdomScreenView k={data} />;
}

export function KingdomScreenView({ k, initialSelected, initialResult }: { k: KingdomScreen; initialSelected?: string; initialResult?: AttackResponse["battle"] }) {
  const [selected, setSelected] = useState<string>(initialSelected ?? "capital");
  const [result, setResult] = useState<AttackResponse["battle"]>(initialResult ?? null);
  const t = k.territories.find((x) => x.code === selected) ?? k.territories[0];
  useConstructionWatcher(k.construction?.completedAt ?? null);

  return (
    <div className="grid gap-4">
      <ResourceBar k={k} />
      <div className="grid gap-4 lg:grid-cols-5">
        <section className="pixel-panel pixel-panel-gold p-3 sm:p-4 lg:col-span-3" aria-label="Карта королевства">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h1 className="font-display text-xl text-gold">Карта королевства</h1>
            <Legend />
          </div>
          <RealmMap territories={k.territories} selected={t.code} onSelect={(c) => setSelected(c)} />
          {k.pendingDays > 0 && <p className="mt-2 text-xs text-muted">Летописцы досчитывают пропущенные дни: осталось {k.pendingDays}…</p>}
        </section>
        <div className="lg:col-span-2">
          <TerritoryPanel key={t.code} t={t} k={k} onResult={setResult} />
        </div>
      </div>
      {result && <BattleResultCard r={result} onClose={() => setResult(null)} />}
      <div className="grid gap-4 lg:grid-cols-2">
        <ArmyPanel k={k} />
        <BattleLog k={k} />
      </div>
    </div>
  );
}

/** When a construction finishes, refetch so the new level shows up. */
function useConstructionWatcher(completedAt: string | null) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!completedAt) return;
    const ms = Date.parse(completedAt) - Date.now();
    if (ms > 2 ** 31 - 1) return;
    const id = setTimeout(() => qc.invalidateQueries({ queryKey: KINGDOM_KEY }), Math.max(0, ms) + 1500);
    return () => clearTimeout(id);
  }, [completedAt, qc]);
}

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------
function ResourceBar({ k }: { k: KingdomScreen }) {
  const r = k.resources;
  const p = k.production;
  return (
    <section className="pixel-panel p-3" aria-label="Казна">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="font-display text-gold">{k.kingdomName}</div>
        <dl className="grid flex-1 grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-5 sm:justify-items-end">
          <Res icon="🪙" label={RESOURCE_LABELS.gold} value={r.gold} delta={p.gold} />
          <Res icon="🌾" label={RESOURCE_LABELS.food} value={r.food} delta={p.food - k.upkeep} />
          <Res icon="📘" label={RESOURCE_LABELS.knowledge} value={r.knowledge} delta={p.knowledge} />
          <Res icon="🎖️" label={RESOURCE_LABELS.influence} value={r.influence} delta={p.influence} />
          <div className="flex items-center gap-1" title="Очки командования: одна атака тратит одно очко, восстанавливается одно в день">
            <dt aria-label={RESOURCE_LABELS.command_points}>🚩</dt>
            <dd className="font-display">
              {r.commandPoints}/{k.maxCommandPoints}
            </dd>
          </div>
        </dl>
      </div>
      <p className="mt-2 text-xs text-muted">
        Доход в день по правилам королевства. Провизия уже за вычетом содержания армии ({k.upkeep}). Замок {k.castleLevel} ур.
        {k.construction ? (
          <>
            {" "}
            · Стройка: {BUILDINGS[k.construction.type].icon} {BUILDINGS[k.construction.type].name} {k.construction.level} ур. ({k.construction.territory}), готово{" "}
            {formatReady(k.construction.completedAt)}
          </>
        ) : (
          " · Строители свободны"
        )}
      </p>
    </section>
  );
}

function Res({ icon, label, value, delta }: { icon: string; label: string; value: number; delta: number }) {
  return (
    <div className="flex items-center gap-1" title={label}>
      <dt aria-label={label}>{icon}</dt>
      <dd className="font-display">
        {value.toLocaleString("ru-RU")}
        <span className={`ml-1 text-xs ${delta < 0 ? "text-danger" : "text-xp"}`}>
          {delta >= 0 ? "+" : ""}
          {delta}
        </span>
      </dd>
    </div>
  );
}

function formatReady(iso: string) {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? `в ${d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`
    : d.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------
function Legend() {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
      {(Object.keys(OWNER) as TerritoryOwner[]).map((o) => (
        <li key={o} className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5" style={{ background: OWNER[o].color }} aria-hidden />
          {OWNER[o].label}
        </li>
      ))}
    </ul>
  );
}

function RealmMap({ territories, selected, onSelect }: { territories: TerritoryView[]; selected: string; onSelect: (code: string) => void }) {
  const cols = Math.max(...territories.map((t) => t.x)) + 1;
  const sorted = [...territories].sort((a, b) => a.y - b.y || a.x - b.x);
  return (
    <div className="grid gap-1.5 bg-bg-deep p-1.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }} role="group" aria-label="Территории">
      {sorted.map((t) => {
        const isSel = t.code === selected;
        const o = OWNER[t.owner];
        return (
          <button
            key={t.code}
            onClick={() => onSelect(t.code)}
            aria-pressed={isSel}
            aria-label={`${t.name}: ${t.owner === "FACTION" ? t.faction : o.label}`}
            className="group relative aspect-[4/3] overflow-hidden text-left outline-none focus-visible:ring-2 focus-visible:ring-text"
            style={{ boxShadow: `inset 0 0 0 ${isSel ? 4 : 3}px ${o.color}`, outline: isSel ? "2px solid #fff" : undefined, outlineOffset: -1 }}
          >
            <TerrainArt terrain={t.terrain} seed={t.code} />
            <span className="absolute inset-0" style={{ background: `linear-gradient(transparent 45%, rgba(11,8,16,.85))` }} aria-hidden />
            <span className="absolute left-1.5 top-1 text-sm drop-shadow sm:text-base" aria-hidden>
              {t.code === "capital" ? "🏰" : t.owner === "RIVAL" ? "🏴" : t.owner === "FACTION" ? "⛺" : t.buildings.length ? "🏠" : ""}
            </span>
            {t.attackable && (
              <span className="absolute right-1.5 top-1 bg-danger/90 px-1 text-[10px] font-bold leading-4 text-white" aria-hidden>
                ⚔
              </span>
            )}
            <span className="absolute inset-x-1.5 bottom-1 block">
              <span className="block truncate font-display text-[11px] leading-tight text-text sm:text-sm">{t.name}</span>
              <span className={`block truncate text-[10px] leading-tight sm:text-xs ${o.text}`}>
                🛡 {t.garrison}
                {t.fortification > 0 ? ` · 🧱${t.fortification}` : ""}
              </span>
            </span>
            {isSel && <span className="absolute inset-0 bg-white/10" aria-hidden />}
          </button>
        );
      })}
    </div>
  );
}

const TERRAIN_PALETTE: Record<Terrain, { base: string; dots: string[]; feature?: string }> = {
  plains: { base: "#4f7a3a", dots: ["#5f8c44", "#6b9a4a", "#c9b458"] },
  forest: { base: "#2c5530", dots: ["#1f3f24", "#3a6b3a", "#173019"], feature: "tree" },
  hills: { base: "#6b6a3a", dots: ["#7d7a44", "#57542e", "#8a8a52"], feature: "hill" },
  mountains: { base: "#4d4a57", dots: ["#5d5a68", "#3b3945", "#6e6b7a"], feature: "peak" },
  river: { base: "#3f6e3c", dots: ["#4d7f47", "#355c33"], feature: "river" },
  coast: { base: "#c7b07a", dots: ["#d6c089", "#b49e68"], feature: "sea" },
};

/** Deterministic pixel terrain: 16×12 cells drawn as crisp SVG rects. */
function TerrainArt({ terrain, seed }: { terrain: Terrain; seed: string }) {
  const rects = useMemo(() => {
    const W = 16;
    const H = 12;
    const p = TERRAIN_PALETTE[terrain];
    const rng = createSeededRandom(hashString(`${terrain}:${seed}`));
    const out: { x: number; y: number; w?: number; h?: number; c: string }[] = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (rng() < 0.35) out.push({ x, y, c: p.dots[Math.floor(rng() * p.dots.length)] });
    if (p.feature === "river") {
      let x = 4 + Math.floor(rng() * 6);
      for (let y = 0; y < H; y++) {
        out.push({ x, y, w: 2, h: 1, c: "#4a8fd0" });
        out.push({ x: x + 1, y, w: 1, h: 1, c: "#7ab8ec" });
        x = Math.max(1, Math.min(W - 3, x + Math.floor(rng() * 3) - 1));
      }
    }
    if (p.feature === "sea") {
      for (let y = 0; y < H; y++) {
        const edge = 9 + Math.floor(rng() * 2);
        out.push({ x: edge, y, w: W - edge, h: 1, c: "#2f6fa8" });
        if (rng() < 0.5) out.push({ x: edge + 1 + Math.floor(rng() * 4), y, w: 2, h: 1, c: "#5a9bd2" });
      }
    }
    const count = p.feature === "tree" ? 9 : p.feature === "peak" ? 3 : p.feature === "hill" ? 4 : 0;
    for (let i = 0; i < count; i++) {
      const cx = 1 + Math.floor(rng() * (W - 4));
      const cy = 1 + Math.floor(rng() * (H - 5));
      if (p.feature === "tree") {
        out.push({ x: cx + 1, y: cy, c: "#2f7a3a" }, { x: cx, y: cy + 1, w: 3, h: 1, c: "#24622d" }, { x: cx + 1, y: cy + 2, c: "#5a3a22" });
      } else if (p.feature === "peak") {
        out.push({ x: cx + 2, y: cy, w: 1, h: 1, c: "#f0eef5" });
        out.push({ x: cx + 1, y: cy + 1, w: 3, h: 1, c: "#8d8a99" }, { x: cx + 2, y: cy + 1, c: "#f0eef5" });
        out.push({ x: cx, y: cy + 2, w: 5, h: 1, c: "#6e6b7a" });
        out.push({ x: cx - 1, y: cy + 3, w: 7, h: 1, c: "#5d5a68" });
      } else {
        out.push({ x: cx + 1, y: cy, w: 2, h: 1, c: "#9a9658" }, { x: cx, y: cy + 1, w: 4, h: 1, c: "#7d7a44" });
      }
    }
    return { W, H, base: p.base, out };
  }, [terrain, seed]);
  return (
    <svg viewBox={`0 0 ${rects.W} ${rects.H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full" shapeRendering="crispEdges" aria-hidden>
      <rect width={rects.W} height={rects.H} fill={rects.base} />
      {rects.out.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w ?? 1} height={r.h ?? 1} fill={r.c} />
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Territory panel
// ---------------------------------------------------------------------------
function TerritoryPanel({ t, k, onResult }: { t: TerritoryView; k: KingdomScreen; onResult: (r: AttackResponse["battle"]) => void }) {
  const o = OWNER[t.owner];
  return (
    <section className="pixel-panel p-4" aria-label={`Территория ${t.name}`} style={{ borderColor: o.color }}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-display text-xl">{t.name}</h2>
          <div className={`text-sm ${o.text}`}>{t.owner === "FACTION" ? `Фракция: ${t.faction}` : t.owner === "HERO" ? "Ваша территория" : t.owner === "RIVAL" ? "Владения Каэля" : "Нейтральная земля"}</div>
        </div>
        <div className="text-right text-xs text-muted">
          {TERRAIN_LABELS[t.terrain]}
          <br />
          защита ×{TERRAIN_DEFENSE[t.terrain]}
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
        <Cell label="Ресурс" value={`${RES_ICON[t.resource]} ${RESOURCE_LABELS[t.resource]}`} />
        <Cell label="Гарнизон" value={`🛡 ${t.garrison}`} />
        <Cell label="Укрепления" value={`🧱 ${t.fortification}`} />
      </dl>

      {t.owner === "HERO" ? (
        <HeroLand t={t} />
      ) : t.attackable ? (
        <AttackPanel t={t} k={k} onResult={onResult} />
      ) : (
        <p className="mt-4 text-sm text-muted">
          {t.owner === "RIVAL" && t.code === "black_reach"
            ? "Столица Каэля. Она далеко, а её стены слишком крепки для первых походов."
            : "Эта земля не граничит с вашими владениями. Захватите соседние территории, чтобы до неё добраться."}
        </p>
      )}
    </section>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-2 border-border bg-bg-deep p-1.5">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className="font-display text-sm">{value}</dd>
    </div>
  );
}

function HeroLand({ t }: { t: TerritoryView }) {
  const build = useBuild();
  return (
    <>
      <h3 className="mt-4 font-display text-gold">Постройки</h3>
      {t.buildings.length === 0 ? (
        <p className="text-sm text-muted">Пока ничего не построено.</p>
      ) : (
        <ul className="mt-1 grid gap-1 text-sm">
          {t.buildings.map((b) => (
            <li key={b.id} className="flex justify-between">
              <span>
                {BUILDINGS[b.type].icon} {BUILDINGS[b.type].name}
              </span>
              <span className="font-display">
                {b.status === "BUILDING" ? <span className="text-gold">→ {b.level} ур., готово {formatReady(b.completedAt)}</span> : `${b.level} ур.`}
              </span>
            </li>
          ))}
        </ul>
      )}
      <h3 className="mt-4 font-display text-gold">Строить</h3>
      <ul className="mt-1 grid gap-2">
        {t.buildOptions.map((o) => {
          const d = BUILDINGS[o.type];
          return (
            <li key={o.type} className="flex items-center gap-2 border-2 border-border bg-bg-deep p-2">
              <span className="text-xl" aria-hidden>
                {d.icon}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">
                  {d.name} → {o.nextLevel} ур.
                </div>
                <div className="text-xs text-muted">
                  🪙 {o.cost.gold}
                  {o.cost.food ? ` · 🌾 ${o.cost.food}` : ""} · ⏳ {formatMinutes(o.minutes)}
                  {o.reason ? <span className="text-danger"> · {o.reason}</span> : null}
                </div>
              </div>
              <button
                className="pixel-btn px-3 text-sm"
                disabled={!o.allowed || build.isPending}
                title={d.description}
                onClick={() => build.mutate({ territoryCode: t.code, buildingType: o.type, name: d.name })}
              >
                Строить
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function formatMinutes(m: number) {
  return m >= 60 ? `${Math.floor(m / 60)} ч${m % 60 ? ` ${m % 60} мин` : ""}` : `${m} мин`;
}

const TACTIC_SHORT: Record<Tactic, string> = { cautious: "Осторожно", balanced: "Баланс", aggressive: "Натиск" };

const RISK_STYLE = {
  low: { label: "Низкий риск", cls: "text-xp" },
  medium: { label: "Средний риск", cls: "text-gold" },
  high: { label: "Высокий риск", cls: "text-danger" },
} as const;

function AttackPanel({ t, k, onResult }: { t: TerritoryView; k: KingdomScreen; onResult: (r: AttackResponse["battle"]) => void }) {
  const [tactic, setTactic] = useState<Tactic>("balanced");
  const [commander, setCommander] = useState<"self" | "none">("self");
  const attack = useAttack();
  const risk = estimateRisk({
    army: k.army.units,
    morale: k.army.morale,
    commander,
    strategy: k.heroStrategy,
    tactic,
    target: { terrain: t.terrain, garrison: t.garrison, fortification: t.fortification, resource: t.resource },
  });
  const blocked = k.resources.commandPoints < 1 ? "Нет очков командования: новое появится завтра." : k.army.size < 1 ? "Армия пуста. Наймите войска в казармах." : null;
  const rs = RISK_STYLE[risk.level];

  return (
    <div className="mt-4">
      <h3 className="font-display text-gold">Поход</h3>
      <fieldset className="mt-2">
        <legend className="text-xs text-muted">Тактика</legend>
        <div className="mt-1 grid grid-cols-3 gap-1">
          {(Object.keys(TACTICS) as Tactic[]).map((x) => (
            <button key={x} className={`pixel-btn px-1 text-xs ${tactic === x ? "border-gold text-gold" : ""}`} aria-pressed={tactic === x} onClick={() => setTactic(x)}>
              {TACTIC_SHORT[x]}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted">
          {TACTICS[tactic].name} тактика: сила ×{TACTICS[tactic].power}, потери ×{TACTICS[tactic].losses}
        </p>
      </fieldset>
      <fieldset className="mt-2">
        <legend className="text-xs text-muted">Командир</legend>
        <div className="mt-1 grid grid-cols-2 gap-1">
          <button className={`pixel-btn px-1 text-xs ${commander === "self" ? "border-gold text-gold" : ""}`} aria-pressed={commander === "self"} onClick={() => setCommander("self")}>
            Лично (Стратегия {k.heroStrategy})
          </button>
          <button className={`pixel-btn px-1 text-xs ${commander === "none" ? "border-gold text-gold" : ""}`} aria-pressed={commander === "none"} onClick={() => setCommander("none")}>
            Без командира
          </button>
        </div>
      </fieldset>

      <div className="mt-3 border-2 border-border bg-bg-deep p-2 text-sm">
        <div className="flex items-baseline justify-between">
          <span className={`font-display ${rs.cls}`}>{rs.label}</span>
          <span className="font-display">шанс ≈ {Math.round(risk.winChance * 100)}%</span>
        </div>
        <div className="mt-1 flex justify-between text-xs text-muted">
          <span>Ваша сила: {Math.round(risk.attackerPower)}</span>
          <span>Оборона: {Math.round(risk.defenderPower)}</span>
        </div>
        <p className="mt-1 text-[11px] text-muted">Оценка до боя. Исход решат правила битвы и случайность в пределах ±10%.</p>
      </div>

      {blocked && <p className="mt-2 text-xs text-danger">{blocked}</p>}
      <button
        className="pixel-btn pixel-btn-gold mt-3 w-full"
        disabled={!!blocked || attack.isPending}
        onClick={() => attack.mutate({ territoryCode: t.code, tactic, commander }, { onSuccess: (r) => onResult(r.battle) })}
      >
        {attack.isPending ? "Битва идёт…" : `⚔ Атаковать (🚩 1)`}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Battle result
// ---------------------------------------------------------------------------
function BattleResultCard({ r, onClose }: { r: NonNullable<AttackResponse["battle"]>; onClose: () => void }) {
  const lost = UNIT_TYPES.filter((u) => (r.casualties[u] ?? 0) > 0);
  return (
    <section className={`pixel-panel p-4 ${r.win ? "pixel-panel-gold" : ""}`} aria-live="polite" aria-label="Итог битвы" style={r.win ? undefined : { borderColor: "var(--danger)" }}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className={`font-display text-2xl ${r.win ? "text-gold" : "text-danger"}`}>{r.win ? "Победа!" : "Поражение"}</h2>
          <div className="text-sm text-muted">
            {r.territoryName} · тактика: {TACTICS[r.tactic].name.toLowerCase()}
          </div>
        </div>
        <button className="pixel-btn px-3 text-sm" onClick={onClose} aria-label="Закрыть итог битвы">
          ✕
        </button>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-center">
        <div className="border-2 border-border bg-bg-deep p-2">
          <div className="text-xs text-muted">Ваша сила</div>
          <div className="font-display text-xl text-xp">{Math.round(r.attackerPower)}</div>
        </div>
        <div className="border-2 border-border bg-bg-deep p-2">
          <div className="text-xs text-muted">Оборона</div>
          <div className="font-display text-xl text-danger">{Math.round(r.defenderPower)}</div>
        </div>
      </div>
      <div className="mt-3 grid gap-1 text-sm sm:grid-cols-3">
        <div>
          <span className="text-muted">Потери: </span>
          {lost.length ? lost.map((u) => `${UNITS[u].icon} ${UNITS[u].name} −${r.casualties[u]}`).join(", ") : "без потерь"}
        </div>
        <div>
          <span className="text-muted">Добыча: </span>
          {r.win ? [r.rewards.gold && `🪙 +${r.rewards.gold}`, r.rewards.food && `🌾 +${r.rewards.food}`, r.rewards.influence && `🎖️ +${r.rewards.influence}`].filter(Boolean).join(" ") || "—" : "—"}
        </div>
        <div>
          <span className="text-muted">Территория: </span>
          {r.win ? `теперь ваша (гарнизон ${r.garrisonAfter})` : `осталась за прежним владельцем`}
        </div>
      </div>
      <p className="mt-2 text-xs text-muted">Битвы приносят ресурсы и земли, но не опыт: опыт даётся только за реальные задания.</p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Army
// ---------------------------------------------------------------------------
function ArmyPanel({ k }: { k: KingdomScreen }) {
  const a = k.army;
  return (
    <section className="pixel-panel p-4" aria-label="Армия">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-gold">Армия</h2>
        <span className="text-sm text-muted">
          {a.size}/{a.cap} · сила {a.power} · мораль {a.morale}
        </span>
      </div>
      <ul className="mt-2 grid grid-cols-2 gap-1 text-sm sm:grid-cols-3">
        {UNIT_TYPES.filter((u) => (a.units[u] ?? 0) > 0).map((u) => (
          <li key={u} className="border-2 border-border bg-bg-deep px-2 py-1">
            {UNITS[u].icon} {UNITS[u].name}: <span className="font-display">{a.units[u]}</span>
          </li>
        ))}
        {a.size === 0 && <li className="text-muted">Войск нет.</li>}
      </ul>
      <h3 className="mt-4 font-display text-gold">Найм</h3>
      <ul className="mt-1 grid gap-2">
        {k.recruitOptions.map((o) => (
          <RecruitRow key={o.type} o={o} />
        ))}
      </ul>
    </section>
  );
}

function RecruitRow({ o }: { o: RecruitOption }) {
  const [qty, setQty] = useState(1);
  const recruit = useRecruit();
  const u = UNITS[o.type];
  const max = Math.max(1, o.maxAffordable);
  const q = Math.min(qty, max);
  const cost = (["gold", "food", "knowledge", "influence"] as const).filter((r) => o.unitCost[r] > 0).map((r) => `${RES_ICON[r]} ${o.unitCost[r] * q}`);
  return (
    <li className="flex flex-wrap items-center gap-2 border-2 border-border bg-bg-deep p-2">
      <span className="text-xl" aria-hidden>
        {u.icon}
      </span>
      <div className="min-w-[11rem] flex-1">
        <div className="text-sm font-semibold">{u.name}</div>
        <div className="text-xs text-muted">
          ⚔{u.attack} 🛡{u.defense} ❤{u.health} · {cost.join(" ")}
          {o.reason ? <span className="text-danger"> · {o.reason}</span> : null}
        </div>
      </div>
      <div className="ml-auto flex items-center gap-1">
        <button className="pixel-btn px-2 text-sm" disabled={!o.allowed || q <= 1} onClick={() => setQty(q - 1)} aria-label={`Меньше: ${u.name}`}>
          −
        </button>
        <span className="w-7 text-center font-display" aria-live="polite">
          {q}
        </span>
        <button className="pixel-btn px-2 text-sm" disabled={!o.allowed || q >= max} onClick={() => setQty(q + 1)} aria-label={`Больше: ${u.name}`}>
          +
        </button>
        <button className="pixel-btn px-3 text-sm" disabled={!o.allowed || recruit.isPending} onClick={() => recruit.mutate({ unitType: o.type, quantity: q, name: u.name }, { onSuccess: () => setQty(1) })}>
          Нанять
        </button>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Battle log
// ---------------------------------------------------------------------------
function BattleLog({ k }: { k: KingdomScreen }) {
  return (
    <section className="pixel-panel p-4" aria-label="Журнал битв">
      <h2 className="font-display text-gold">Журнал битв</h2>
      {k.battles.length === 0 ? (
        <p className="mt-1 text-sm text-muted">Пока ни одной битвы. Соседние земли с отметкой ⚔ можно атаковать.</p>
      ) : (
        <ul className="mt-2 grid gap-2 text-sm">
          {k.battles.map((b) => (
            <li key={b.id} className="border-l-4 pl-2" style={{ borderColor: b.attacker === "RIVAL" ? "var(--rival)" : b.win ? "var(--xp)" : "var(--danger)" }}>
              <div className="flex justify-between gap-2">
                <span className="font-semibold">
                  {b.attacker === "RIVAL" ? `Каэль ${b.win ? "захватил" : "не смог взять"}` : b.win ? "Захвачено:" : "Отбиты у"} {b.territoryName}
                </span>
                <span className="shrink-0 text-xs text-muted">{new Date(b.at).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}</span>
              </div>
              <div className="text-xs text-muted">
                {b.attackerPower != null && b.defenderPower != null ? `${Math.round(b.attackerPower)} против ${Math.round(b.defenderPower)}` : ""}
                {casualtiesText(b.casualties)}
                {b.win && b.attacker === "HERO" && b.rewards.gold ? ` · 🪙 +${b.rewards.gold}` : ""}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function casualtiesText(c: Army) {
  const n = UNIT_TYPES.reduce((s, u) => s + (c[u] ?? 0), 0);
  return n > 0 ? ` · потери ${n}` : "";
}
