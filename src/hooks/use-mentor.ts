"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { apiFetch, newIdempotencyKey } from "@/lib/api-client";
import { useUiStore } from "@/stores/ui-store";
import type { AiStatus, CompleteQuestResult, GameState, MentorEvaluationView, MentorMessageView, MentorView } from "@/types/game";
import { GAME_STATE_KEY } from "./use-game";

export const MENTOR_KEY = ["mentor"] as const;
export const AI_SETTINGS_KEY = ["ai-settings"] as const;

export function useMentorView() {
  return useQuery({ queryKey: MENTOR_KEY, queryFn: () => apiFetch<MentorView>("/api/ai/mentor/view") });
}

export function useMentorChat() {
  const qc = useQueryClient();
  const push = useUiStore((s) => s.pushToast);
  return useMutation({
    mutationFn: (message: string) =>
      apiFetch<{ reply: MentorMessageView; source: "AI" | "FALLBACK"; notice: string | null; messages: MentorMessageView[] }>(
        "/api/ai/mentor/chat",
        { method: "POST", json: { message } },
      ),
    onSuccess: (r) => {
      qc.setQueryData<MentorView>(MENTOR_KEY, (v) => (v ? { ...v, messages: r.messages } : v));
      if (r.notice) push("info", r.notice);
      qc.invalidateQueries({ queryKey: MENTOR_KEY });
    },
    onError: (e) => push("error", e instanceof Error ? e.message : "Ошибка"),
  });
}

export function useGenerateQuests() {
  const qc = useQueryClient();
  const push = useUiStore((s) => s.pushToast);
  return useMutation({
    mutationFn: () => apiFetch<{ status: string; message: string; state: GameState }>("/api/ai/quests/generate", { method: "POST" }),
    onSuccess: (r) => {
      qc.setQueryData(GAME_STATE_KEY, r.state);
      push(r.status === "applied" ? "success" : "info", r.message);
      qc.invalidateQueries({ queryKey: MENTOR_KEY });
    },
    onError: (e) => push("error", e instanceof Error ? e.message : "Ошибка"),
  });
}

export type EvaluateResponse =
  | { status: "evaluated"; evaluation: MentorEvaluationView; completion: CompleteQuestResult }
  | { status: "ai_unavailable"; message: string };

export function useEvaluateAnswer() {
  const qc = useQueryClient();
  const push = useUiStore((s) => s.pushToast);
  // Same key per quest for retries: a repeated tap never pays twice.
  const keys = useRef(new Map<string, string>());
  return useMutation({
    mutationFn: (vars: { questId: string; answer: string }) => {
      let key = keys.current.get(vars.questId);
      if (!key) {
        key = newIdempotencyKey();
        keys.current.set(vars.questId, key);
      }
      return apiFetch<EvaluateResponse>("/api/ai/mentor/evaluate", {
        method: "POST",
        json: { questId: vars.questId, answer: vars.answer, idempotencyKey: key },
      });
    },
    onSuccess: (r) => {
      if (r.status === "evaluated") {
        qc.setQueryData(GAME_STATE_KEY, r.completion.state);
        const c = r.completion;
        push("success", `Оценка Ориона: ${r.evaluation.grade}${c.awardedXp > 0 ? ` · +${c.awardedXp} XP` : ""}`);
        if (c.leveledUp) push("level", `Новый уровень: ${c.level}!`);
        qc.invalidateQueries({ queryKey: MENTOR_KEY });
      } else {
        push("info", r.message);
      }
    },
    onError: (e) => push("error", e instanceof Error ? e.message : "Ошибка"),
  });
}

export function useAiSettings() {
  return useQuery({ queryKey: AI_SETTINGS_KEY, queryFn: () => apiFetch<AiStatus>("/api/ai/mentor/settings") });
}

export function useSaveAiSettings() {
  const qc = useQueryClient();
  const push = useUiStore((s) => s.pushToast);
  return useMutation({
    mutationFn: (input: { dailyLimit: number; monthlyBudgetUsd: number }) =>
      apiFetch<AiStatus>("/api/ai/mentor/settings", { method: "PUT", json: input }),
    onSuccess: (s) => {
      qc.setQueryData(AI_SETTINGS_KEY, s);
      push("success", "Лимиты AI сохранены.");
    },
    onError: (e) => push("error", e instanceof Error ? e.message : "Ошибка"),
  });
}
