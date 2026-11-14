"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface StartedState {
  started: Record<string, string>;
  start: (questId: string) => void;
}

/** "Начать" is a UI marker only — it never affects rewards. */
export const useStartedQuests = create<StartedState>()(
  persist(
    (set) => ({
      started: {},
      start: (questId) =>
        set((s) => {
          const entries = Object.entries(s.started).slice(-50);
          return { started: { ...Object.fromEntries(entries), [questId]: new Date().toISOString() } };
        }),
    }),
    { name: "nemesis-started" },
  ),
);
