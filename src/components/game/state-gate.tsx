"use client";

import { useGameState } from "@/hooks/use-game";
import type { GameState } from "@/types/game";

/** Renders children with the game state, plus loading / error / stale-offline handling. */
export function StateGate({ children }: { children: (state: GameState) => React.ReactNode }) {
  const { data, error, isPending, isPlaceholderData, refetch } = useGameState();
  if (data) {
    return (
      <>
        {(isPlaceholderData || error) && (
          <div className="mb-3 border-2 border-border bg-panel px-3 py-2 text-xs text-muted">
            Показано последнее сохранённое состояние{error ? ": сервер недоступен" : ", обновляю…"}.
          </div>
        )}
        {children(data)}
      </>
    );
  }
  if (isPending) {
    return <div className="py-16 text-center font-pixel text-muted">Загрузка королевства…</div>;
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
