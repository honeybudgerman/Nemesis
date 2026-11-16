"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import type { Interaction, Position } from "@/data/court/npcs";
import { apiFetch, ApiClientError, newIdempotencyKey } from "@/lib/api-client";
import { useUiStore } from "@/stores/ui-store";
import type { CourtScreen, NpcDetail, OutcomeView } from "@/types/court";
import { GAME_STATE_KEY } from "./use-game";
import { KINGDOM_KEY } from "./use-kingdom";

export const COURT_KEY = ["court"] as const;
export const npcKey = (code: string) => ["court", "npc", code] as const;

export function useCourt() {
  return useQuery({ queryKey: COURT_KEY, queryFn: () => apiFetch<CourtScreen>("/api/court"), refetchOnWindowFocus: true });
}

export function useNpc(code: string | null) {
  return useQuery({
    queryKey: npcKey(code ?? "-"),
    queryFn: () => apiFetch<NpcDetail>(`/api/court/npcs/${code}`),
    enabled: !!code,
  });
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
      if (e instanceof ApiClientError && e.status === 0) return; // network: keep for the retry
      keys.current.delete(id);
    },
  };
}

export interface InteractResponse {
  status: "applied" | "duplicate";
  line: { content: string; source: "AI" | "FALLBACK" } | null;
  effects: string[];
  detail: NpcDetail;
}

export function useInteract() {
  const qc = useQueryClient();
  const push = useUiStore((s) => s.pushToast);
  const keys = useKeys();
  return useMutation({
    mutationFn: (v: { npcCode: string; action: Interaction }) =>
      apiFetch<InteractResponse>("/api/court/interact", { method: "POST", json: { ...v, idempotencyKey: keys.get(`${v.npcCode}:${v.action}`) } }),
    onSuccess: (r, v) => {
      keys.settle(`${v.npcCode}:${v.action}`);
      qc.setQueryData(npcKey(v.npcCode), r.detail);
      qc.invalidateQueries({ queryKey: COURT_KEY, exact: true });
      qc.invalidateQueries({ queryKey: KINGDOM_KEY });
      qc.invalidateQueries({ queryKey: GAME_STATE_KEY });
      if (r.effects.length) push("info", r.effects.join(" · "));
    },
    onError: (e, v) => {
      keys.settle(`${v.npcCode}:${v.action}`, e);
      push("error", e instanceof Error ? e.message : "Ошибка");
    },
  });
}

export function useChoose() {
  const qc = useQueryClient();
  const push = useUiStore((s) => s.pushToast);
  const keys = useKeys();
  return useMutation({
    mutationFn: (v: { eventId: string; choice: string }) =>
      apiFetch<{ status: string; outcome: OutcomeView | null; screen: CourtScreen }>("/api/court/choose", { method: "POST", json: { ...v, idempotencyKey: keys.get(v.eventId) } }),
    onSuccess: (r, v) => {
      keys.settle(v.eventId);
      qc.setQueryData(COURT_KEY, r.screen);
      qc.invalidateQueries({ queryKey: ["court", "npc"] });
      qc.invalidateQueries({ queryKey: KINGDOM_KEY });
      qc.invalidateQueries({ queryKey: GAME_STATE_KEY });
    },
    onError: (e, v) => {
      keys.settle(v.eventId, e);
      push("error", e instanceof Error ? e.message : "Ошибка");
    },
  });
}

export function useAssign() {
  const qc = useQueryClient();
  const push = useUiStore((s) => s.pushToast);
  const keys = useKeys();
  return useMutation({
    mutationFn: (v: { position: Position; npcCode: string | null }) =>
      apiFetch<{ status: string; effects: string[]; screen: CourtScreen }>("/api/court/assign", { method: "POST", json: { ...v, idempotencyKey: keys.get(`${v.position}:${v.npcCode}`) } }),
    onSuccess: (r, v) => {
      keys.settle(`${v.position}:${v.npcCode}`);
      qc.setQueryData(COURT_KEY, r.screen);
      qc.invalidateQueries({ queryKey: ["court", "npc"] });
      qc.invalidateQueries({ queryKey: KINGDOM_KEY });
      push("success", r.effects.length ? r.effects.join(" · ") : "Назначение сохранено.");
    },
    onError: (e, v) => {
      keys.settle(`${v.position}:${v.npcCode}`, e);
      push("error", e instanceof Error ? e.message : "Ошибка");
    },
  });
}
