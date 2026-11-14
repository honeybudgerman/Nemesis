"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Portrait } from "@/components/characters/portrait";
import { GAME_STATE_KEY } from "@/hooks/use-game";
import { apiFetch } from "@/lib/api-client";
import type { GameState } from "@/types/game";

const BUDGETS = [30, 45, 55, 60, 90, 120];

function zones(): string[] {
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    if (supported) return supported("timeZone");
  } catch {
    /* fall through */
  }
  return ["UTC", "Europe/Moscow", "Asia/Jerusalem", "Europe/Kyiv", "Europe/Berlin", "America/New_York"];
}

export function StartForm() {
  const router = useRouter();
  const qc = useQueryClient();
  const allZones = useMemo(zones, []);
  const [displayName, setDisplayName] = useState("");
  const [heroName, setHeroName] = useState("");
  const [kingdomName, setKingdomName] = useState("");
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [dailyMinutes, setDailyMinutes] = useState(55);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<{ created: boolean; state: GameState }>("/api/game/start", {
        method: "POST",
        json: { displayName, heroName, kingdomName, timezone, dailyMinutes },
      });
      qc.setQueryData(GAME_STATE_KEY, r.state);
      router.replace("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="pixel-panel pixel-panel-gold p-5 sm:p-6">
      <div className="flex items-center gap-4">
        <Portrait kind="hero" size={64} title="Ваш герой" />
        <div>
          <h1 className="font-display text-xl text-gold">Глава 1. Два наследника</h1>
          <p className="mt-1 text-sm text-text/85">
            Старый король умер. Престол делят двое наследников — вы и Каэль Валькарион. Кто станет королём, решат не
            мечи, а ежедневный труд.
          </p>
        </div>
      </div>

      <label className="mt-5 block">
        <span className="text-sm text-muted">Как к вам обращаться</span>
        <input className="pixel-input mt-1" required maxLength={40} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Игорь" />
      </label>
      <label className="mt-3 block">
        <span className="text-sm text-muted">Имя героя</span>
        <input className="pixel-input mt-1" required minLength={2} maxLength={24} value={heroName} onChange={(e) => setHeroName(e.target.value)} placeholder="Арен Светлый" />
      </label>
      <label className="mt-3 block">
        <span className="text-sm text-muted">Название королевства</span>
        <input className="pixel-input mt-1" required minLength={2} maxLength={32} value={kingdomName} onChange={(e) => setKingdomName(e.target.value)} placeholder="Северная марка" />
      </label>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm text-muted">Часовой пояс</span>
          <select className="pixel-input mt-1" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            {(allZones.includes(timezone) ? allZones : [timezone, ...allZones]).map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-sm text-muted">Время в день</span>
          <select className="pixel-input mt-1" value={dailyMinutes} onChange={(e) => setDailyMinutes(Number(e.target.value))}>
            {BUDGETS.map((m) => (
              <option key={m} value={m}>
                {m} минут
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="mt-2 text-xs text-muted">Основные ежедневные задания никогда не превысят выбранное время.</p>

      {error && <p className="mt-3 text-sm text-danger" role="alert">{error}</p>}
      <button type="submit" className="pixel-btn pixel-btn-gold mt-5 w-full" disabled={busy}>
        {busy ? "Коронация…" : "Принять наследство"}
      </button>
    </form>
  );
}
