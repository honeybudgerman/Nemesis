"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { ApiClientError, apiFetch, newIdempotencyKey } from "@/lib/api-client";
import { useUiStore } from "@/stores/ui-store";
import type { CompleteQuestResult, GameState } from "@/types/game";

export const GAME_STATE_KEY = ["game-state"] as const;
const CACHE_KEY = "nemesis-last-state-v1";

/** Last confirmed server state, kept for read-only offline viewing (ТЗ §16.3). */
function readCachedState(): GameState | undefined {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as GameState) : undefined;
  } catch {
    return undefined;
  }
}

function writeCachedState(state: GameState) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(state));
  } catch {
    /* storage may be unavailable (private mode) — fine, the server is the source of truth */
  }
}

export function clearCachedState() {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
}

export function useGameState() {
  return useQuery({
    queryKey: GAME_STATE_KEY,
    queryFn: async () => {
      const state = await apiFetch<GameState>("/api/game/state");
      writeCachedState(state);
      return state;
    },
    placeholderData: () => (typeof window === "undefined" ? undefined : readCachedState()),
    refetchOnWindowFocus: true,
    refetchInterval: 5 * 60_000,
    retry: (count, err) => !(err instanceof ApiClientError && err.status === 401) && count < 2,
  });
}

function useSetState() {
  const qc = useQueryClient();
  return (state: GameState) => {
    writeCachedState(state);
    qc.setQueryData(GAME_STATE_KEY, state);
  };
}

function useErrorToast() {
  const push = useUiStore((s) => s.pushToast);
  return (err: unknown) => push("error", err instanceof Error ? err.message : "Ошибка");
}

export function useCompleteQuest() {
  const setState = useSetState();
  const push = useUiStore((s) => s.pushToast);
  const onError = useErrorToast();
  // One key per quest for the lifetime of the page: retries of the same tap
  // reuse it, so the server can recognise duplicates and never pays twice.
  const keys = useRef(new Map<string, string>());

  return useMutation({
    mutationFn: (vars: { questId: string; note?: string }) => {
      let key = keys.current.get(vars.questId);
      if (!key) {
        key = newIdempotencyKey();
        keys.current.set(vars.questId, key);
      }
      return apiFetch<CompleteQuestResult>("/api/quests/complete", {
        method: "POST",
        json: { questId: vars.questId, idempotencyKey: key, note: vars.note },
      });
    },
    onSuccess: (r) => {
      setState(r.state);
      if (r.status === "completed") {
        push("success", r.awardedXp > 0 ? `+${r.awardedXp} XP · +${r.gold} золота` : "Задание выполнено (дневной лимит XP исчерпан)");
        if (r.leveledUp) push("level", `Новый уровень: ${r.level}!`);
      }
    },
    onError,
  });
}

export function useSkipQuest() {
  const setState = useSetState();
  const onError = useErrorToast();
  const push = useUiStore((s) => s.pushToast);
  return useMutation({
    mutationFn: (questId: string) => apiFetch<GameState>("/api/quests/skip", { method: "POST", json: { questId } }),
    onSuccess: (s) => {
      setState(s);
      push("info", "Задание пропущено. Отдых — тоже часть пути.");
    },
    onError,
  });
}

export function useCreateQuest() {
  const setState = useSetState();
  const onError = useErrorToast();
  return useMutation({
    mutationFn: (input: { title: string; description?: string; category: string; difficulty: number; estimatedMinutes: number }) =>
      apiFetch<GameState>("/api/quests/create", { method: "POST", json: input }),
    onSuccess: setState,
    onError,
  });
}
