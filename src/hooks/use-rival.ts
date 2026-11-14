"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { apiFetch } from "@/lib/api-client";
import type { RivalView } from "@/types/game";
import { GAME_STATE_KEY } from "./use-game";

export const RIVAL_KEY = ["rival"] as const;

export function useRivalView() {
  return useQuery({
    queryKey: RIVAL_KEY,
    queryFn: () => apiFetch<RivalView>("/api/rival/profile"),
    refetchOnWindowFocus: true,
  });
}

/**
 * After a long absence the server simulates only one batch per page load; this
 * finishes the catch-up in the background (a few short requests), then refreshes.
 */
export function useRivalCatchUp(pendingDays: number) {
  const qc = useQueryClient();
  const running = useRef(false);
  useEffect(() => {
    if (pendingDays <= 0 || running.current) return;
    running.current = true;
    (async () => {
      try {
        for (let i = 0; i < 10; i++) {
          const r = await apiFetch<{ pendingDays: number }>("/api/rival/sync", { method: "POST" });
          if (r.pendingDays <= 0) break;
        }
      } catch {
        /* next page load retries; the throne room still works */
      } finally {
        running.current = false;
        await Promise.all([
          qc.invalidateQueries({ queryKey: GAME_STATE_KEY }),
          qc.invalidateQueries({ queryKey: RIVAL_KEY }),
        ]);
      }
    })();
  }, [pendingDays, qc]);
}
