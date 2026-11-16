"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { playSfx, type Sfx } from "@/lib/sfx";

export interface Toast {
  id: number;
  kind: "info" | "success" | "error" | "level";
  text: string;
}

interface UiState {
  motionOff: boolean;
  setMotionOff: (v: boolean) => void;
  soundOn: boolean;
  setSoundOn: (v: boolean) => void;
  /** Play a sound effect if sound is on. */
  sfx: (name: Sfx) => void;
  toasts: Toast[];
  pushToast: (kind: Toast["kind"], text: string) => void;
  dismissToast: (id: number) => void;
}

let nextId = 1;

/** Local, UI-only state. Game progress never lives here — the server owns it. */
const TOAST_SOUND: Record<Toast["kind"], Sfx> = { info: "blip", success: "success", error: "fail", level: "levelup" };

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      motionOff: false,
      setMotionOff: (v) => set({ motionOff: v }),
      soundOn: true,
      setSoundOn: (v) => set({ soundOn: v }),
      sfx: (name) => {
        if (get().soundOn) playSfx(name);
      },
      toasts: [],
      pushToast: (kind, text) => {
        const id = nextId++;
        get().sfx(TOAST_SOUND[kind]);
        set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, text }] }));
        setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4000);
      },
      dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
    }),
    { name: "nemesis-ui", partialize: (s) => ({ motionOff: s.motionOff, soundOn: s.soundOn }) },
  ),
);
