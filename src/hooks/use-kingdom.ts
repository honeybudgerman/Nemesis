"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type { BuildingType } from "@/data/realm/buildings";
import type { Tactic, UnitType } from "@/data/realm/units";
import type { BattleResult } from "@/engine/realm/battle";
import { apiFetch, newIdempotencyKey } from "@/lib/api-client";
import { useUiStore } from "@/stores/ui-store";
import type { KingdomScreen } from "@/types/realm";
import { GAME_STATE_KEY } from "./use-game";

export const KINGDOM_KEY = ["kingdom"] as const;

export function useKingdom() {
  return useQuery({ queryKey: KINGDOM_KEY, queryFn: () => apiFetch<KingdomScreen>("/api/kingdom"), refetchOnWindowFocus: true });
}

/** Finishes a long world catch-up in the background (one batch per request). */
export function useKingdomCatchUp(pendingDays: number) {
  const qc = useQueryClient();
  const running = useRef(false);
  useEffect(() => {
    if (pendingDays <= 0 || running.current) return;
    running.current = true;
    (async () => {
      try {
        for (let i = 0; i < 10; i++) {
          const s = await apiFetch<KingdomScreen>("/api/kingdom");
          qc.setQueryData(KINGDOM_KEY, s);
          if (s.pendingDays <= 0) break;
        }
      } catch {
        /* the next visit retries */
      } finally {
        running.current = false;
      }
    })();
  }, [pendingDays, qc]);
}

/**
 * One idempotency key per intended action: retries of the same tap reuse it, so a
 * flaky network never builds, recruits or attacks twice. A fresh key after success.
 */
function useActionKey() {
  const keys = useRef(new Map<string, string>());
  return {
    get(id: string) {
      let k = keys.current.get(id);
      if (!k) {
        k = newIdempotencyKey();
        keys.current.set(id, k);
      }
      return k;
    },
    done(id: string) {
      keys.current.delete(id);
    },
  };
}

function useKingdomMutation<V, R extends { screen: KingdomScreen }>(
  path: string,
  idOf: (v: V) => string,
  body: (v: V) => Record<string, unknown>,
  onDone: (r: R, v: V, push: (kind: "success" | "info" | "error", text: string) => void) => void,
) {
  const qc = useQueryClient();
  const push = useUiStore((s) => s.pushToast);
  const keys = useActionKey();
  return useMutation({
    mutationFn: (v: V) => apiFetch<R>(path, { method: "POST", json: { ...body(v), idempotencyKey: keys.get(idOf(v)) } }),
    onSuccess: (r, v) => {
      keys.done(idOf(v));
      qc.setQueryData(KINGDOM_KEY, r.screen);
      qc.invalidateQueries({ queryKey: GAME_STATE_KEY });
      onDone(r, v, push);
    },
    onError: (e, v) => {
      // A business refusal is final for this attempt; a network failure keeps the key for the retry.
      if (!(e instanceof Error && "status" in e && (e as { status: number }).status === 0)) keys.done(idOf(v));
      push("error", e instanceof Error ? e.message : "Ошибка");
    },
  });
}

export function useBuild() {
  return useKingdomMutation<{ territoryCode: string; buildingType: BuildingType; name: string }, { status: string; screen: KingdomScreen }>(
    "/api/kingdom/build",
    (v) => `${v.territoryCode}:${v.buildingType}`,
    (v) => ({ territoryCode: v.territoryCode, buildingType: v.buildingType }),
    (r, v, push) => push(r.status === "duplicate" ? "info" : "success", r.status === "duplicate" ? "Эта стройка уже идёт." : `Строительство началось: ${v.name}.`),
  );
}

export function useRecruit() {
  return useKingdomMutation<{ unitType: UnitType; quantity: number; name: string }, { status: string; screen: KingdomScreen }>(
    "/api/kingdom/recruit",
    (v) => `${v.unitType}:${v.quantity}`,
    (v) => ({ unitType: v.unitType, quantity: v.quantity }),
    (r, v, push) => push(r.status === "duplicate" ? "info" : "success", r.status === "duplicate" ? "Этот найм уже выполнен." : `Нанято: ${v.name} × ${v.quantity}.`),
  );
}

export interface AttackResponse {
  status: "resolved" | "duplicate";
  battle: (BattleResult & { territoryName: string; tactic: Tactic }) | null;
  screen: KingdomScreen;
}

export function useAttack() {
  return useKingdomMutation<{ territoryCode: string; tactic: Tactic; commander: "self" | "none" }, AttackResponse>(
    "/api/kingdom/attack",
    (v) => `${v.territoryCode}:${v.tactic}:${v.commander}`,
    (v) => ({ territoryCode: v.territoryCode, tactic: v.tactic, commander: v.commander }),
    (r, _v, push) => {
      if (!r.battle) return push("info", "Эта битва уже состоялась.");
      push(r.battle.win ? "success" : "error", r.battle.win ? `Победа! ${r.battle.territoryName} теперь ваша.` : `Поражение у ${r.battle.territoryName}.`);
    },
  );
}
