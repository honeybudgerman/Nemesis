"use client";

import { useUiStore } from "@/stores/ui-store";

const STYLE = {
  info: "border-border",
  success: "border-xp text-xp",
  error: "border-danger text-danger",
  level: "border-gold text-gold",
} as const;

export function Toasts() {
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex flex-col items-center gap-2 px-4" aria-live="polite">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={`pixel-panel anim-pop pointer-events-auto max-w-md px-4 py-2 text-sm font-pixel ${STYLE[t.kind]}`}
        >
          {t.kind === "level" ? "👑 " : ""}
          {t.text}
        </button>
      ))}
    </div>
  );
}
