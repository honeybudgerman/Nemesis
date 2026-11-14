"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface Toast {
  id: number;
  kind: "info" | "success" | "error" | "level";
  text: string;
}

interface UiState {
  motionOff: boolean;
  setMotionOff: (v: boolean) => void;
  toasts: Toast[];
  pushToast: (kind: Toast["kind"], text: string) => void;
  dismissToast: (id: number) => void;
}

let nextId = 1;

/** Local, UI-only state. Game progress never lives here — the server owns it. */
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      motionOff: false,
      setMotionOff: (v) => set({ motionOff: v }),
      toasts: [],
      pushToast: (kind, text) => {
        const id = nextId++;
        set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, text }] }));
        setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4000);
      },
      dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
    }),
    { name: "nemesis-ui", partialize: (s) => ({ motionOff: s.motionOff }) },
  ),
);
