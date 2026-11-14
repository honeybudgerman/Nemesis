"use client";

import { useEffect, useState } from "react";
import { useAiSettings, useSaveAiSettings } from "@/hooks/use-mentor";

/** Manual AI limits (ТЗ §9.4). The OpenRouter key itself is never shown or entered here. */
export function AiSettings() {
  const { data } = useAiSettings();
  const save = useSaveAiSettings();
  const [daily, setDaily] = useState("");
  const [budget, setBudget] = useState("");

  useEffect(() => {
    if (data) {
      setDaily(String(data.dailyLimit));
      setBudget(String(data.monthlyBudgetUsd));
    }
  }, [data]);

  const d = Number(daily);
  const b = Number(budget.replace(",", "."));
  const valid = Number.isInteger(d) && d >= 0 && d <= 200 && Number.isFinite(b) && b >= 0 && b <= 100;

  return (
    <section className="pixel-panel p-4">
      <h2 className="font-display text-gold">Наставник и AI</h2>
      {data ? (
        <>
          <p className="mt-1 text-sm text-text/85">
            {data.configured
              ? `Орион подключён (модель ${data.model}). Сегодня запросов: ${data.todayRequests}, расход за месяц: $${data.monthCostUsd.toFixed(3)}.`
              : "Орион не подключён: на сервере не задан OPENROUTER_API_KEY. Игра работает с подготовленными заданиями и советами."}
          </p>
          <form
            className="mt-3 grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (valid) save.mutate({ dailyLimit: d, monthlyBudgetUsd: b });
            }}
          >
            <label className="text-sm">
              <span className="text-xs text-muted">Запросов в день (0 — выключить)</span>
              <input className="pixel-input mt-1" inputMode="numeric" value={daily} onChange={(e) => setDaily(e.target.value)} />
            </label>
            <label className="text-sm">
              <span className="text-xs text-muted">Бюджет в месяц, $</span>
              <input className="pixel-input mt-1" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} />
            </label>
            <button className="pixel-btn text-sm sm:col-span-2" disabled={!valid || save.isPending}>
              {save.isPending ? "Сохраняю…" : "Сохранить лимиты"}
            </button>
          </form>
        </>
      ) : (
        <p className="mt-1 text-sm text-muted">Загрузка…</p>
      )}
    </section>
  );
}
