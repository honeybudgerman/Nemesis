"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import type { Tactic } from "@/data/realm/units";
import { apiFetch, ApiClientError, newIdempotencyKey } from "@/lib/api-client";
import { useUiStore } from "@/stores/ui-store";
import type { BossOutcome, CompleteOutcome, DecisionOutcome, StoryScreen } from "@/types/story";
import { GAME_STATE_KEY } from "./use-game";
import { KINGDOM_KEY } from "./use-kingdom";

export const STORY_KEY = ["story"] as const;

export function useStory() {
  return useQuery({ queryKey: STORY_KEY, queryFn: () => apiFetch<StoryScreen>("/api/story"), refetchOnWindowFocus: true });
}

/** Same key for retries of one intended action; a fresh key once it is settled. */
function useKeys() {
  const keys = useRef(new Map<string, string>());
  return {
    get: (id: string) => {
      let k = keys.current.get(id);
      if (!k) {
        k = newIdempotencyKey();
        keys.current.set(id, k);
      }
      return k;
    },
    settle: (id: string, e?: unknown) => {
      if (e instanceof ApiClientError && e.status === 0) return;
      keys.current.delete(id);
    },
  };
}

function useAfter() {
  const qc = useQueryClient();
  const push = useUiStore((s) => s.pushToast);
  return {
    push,
    apply: (screen: StoryScreen) => {
      qc.setQueryData(STORY_KEY, screen);
      qc.invalidateQueries({ queryKey: KINGDOM_KEY });
      qc.invalidateQueries({ queryKey: GAME_STATE_KEY });
    },
    fail: (e: unknown) => push("error", e instanceof Error ? e.message : "Ошибка"),
  };
}

export function useMarkSeen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { chapter: string; scene: "intro" | "outro" }) => apiFetch<StoryScreen>("/api/story/seen", { method: "POST", json: v }),
    onSuccess: (screen) => {
      qc.setQueryData(STORY_KEY, screen);
      qc.invalidateQueries({ queryKey: GAME_STATE_KEY });
    },
  });
}

export function useStoryChoose() {
  const after = useAfter();
  const keys = useKeys();
  return useMutation({
    mutationFn: (v: { chapter: string; choice: string }) =>
      apiFetch<DecisionOutcome>("/api/story/choose", { method: "POST", json: { ...v, idempotencyKey: keys.get(v.chapter) } }),
    onSuccess: (r, v) => {
      keys.settle(v.chapter);
      after.apply(r.screen);
    },
    onError: (e, v) => {
      keys.settle(v.chapter, e);
      after.fail(e);
    },
  });
}

export function useBoss() {
  const after = useAfter();
  const keys = useKeys();
  const sfx = useUiStore((s) => s.sfx);
  return useMutation({
    mutationFn: (v: { chapter: string; tactic: Tactic; commander: "self" | "none" | "general" }) =>
      apiFetch<BossOutcome>("/api/story/boss", { method: "POST", json: { ...v, idempotencyKey: keys.get(v.chapter) } }),
    onSuccess: (r, v) => {
      keys.settle(v.chapter);
      after.apply(r.screen);
      if (r.battle) sfx(r.battle.win ? "victory" : "defeat");
    },
    onError: (e, v) => {
      keys.settle(v.chapter, e);
      after.fail(e);
    },
  });
}

export function useCompleteChapter() {
  const after = useAfter();
  const keys = useKeys();
  const sfx = useUiStore((s) => s.sfx);
  return useMutation({
    mutationFn: (v: { chapter: string }) =>
      apiFetch<CompleteOutcome>("/api/story/complete", { method: "POST", json: { ...v, idempotencyKey: keys.get(v.chapter) } }),
    onSuccess: (r, v) => {
      keys.settle(v.chapter);
      after.apply(r.screen);
      if (r.status === "completed") sfx("victory");
    },
    onError: (e, v) => {
      keys.settle(v.chapter, e);
      after.fail(e);
    },
  });
}

export function useSetTitle() {
  const after = useAfter();
  return useMutation({
    mutationFn: (v: { title: string | null }) => apiFetch<StoryScreen>("/api/story/title", { method: "POST", json: v }),
    onSuccess: (screen) => {
      after.apply(screen);
      after.push("success", screen.activeTitle ? `Титул: «${screen.activeTitle.name}»` : "Титул снят.");
    },
    onError: after.fail,
  });
}

export function useChronicle() {
  const qc = useQueryClient();
  const push = useUiStore((s) => s.pushToast);
  return useMutation({
    mutationFn: (v: { chapter: string }) => apiFetch<{ chronicle: string; source: "AI" | "FALLBACK" }>("/api/ai/story/dialogue", { method: "POST", json: v }),
    onSuccess: (r, v) => {
      qc.setQueryData<StoryScreen>(STORY_KEY, (s) =>
        s ? { ...s, chapters: s.chapters.map((c) => (c.code === v.chapter ? { ...c, chronicle: r.chronicle, chronicleSource: r.source } : c)) } : s,
      );
    },
    onError: (e) => push("error", e instanceof Error ? e.message : "Ошибка"),
  });
}
