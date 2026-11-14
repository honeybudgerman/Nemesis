"use client";

import { useGameState } from "@/hooks/use-game";
import { useRivalCatchUp } from "@/hooks/use-rival";
import type { GameState } from "@/types/game";

/** Renders children with the game state, plus loading / error / stale-offline handling. */
export function StateGate({ children }: { children: (state: GameState) => React.ReactNode }) {
  const { data, error, isPending, isPlaceholderData, refetch } = useGameState();
  useRivalCatchUp(isPlaceholderData ? 0 : (data?.rival?.pendingDays ?? 0));
  if (data) {
    return (
      <>
        {(isPlaceholderData || error) && (
          <div className="mb-3 border-2 border-border bg-panel px-3 py-2 text-xs text-muted">
            Показано последнее сохранённое состояние{error ? ": сервер недоступен" : ", обновляю…"}.
          </div>
        )}
        {data.rival && data.rival.pendingDays > 0 && (
          <div className="mb-3 border-2 border-rival/60 bg-panel px-3 py-2 text-xs text-muted">
            Пока вас не было, Каэль не стоял на месте. Восстанавливаю его хронику: осталось дней {data.rival.pendingDays}…
          </div>
        )}
        {children(data)}
      </>
    );
  }
  if (isPending) {
    return <div className="py-16 text-center font-display text-muted">Загрузка королевства…</div>;
  }
  return (
    <div className="pixel-panel p-6 text-center">
      <p className="text-danger">{error instanceof Error ? error.message : "Не удалось загрузить данные."}</p>
      <button className="pixel-btn mt-4" onClick={() => refetch()}>
        Повторить
      </button>
    </div>
  );
}
