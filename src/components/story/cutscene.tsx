"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useUiStore } from "@/stores/ui-store";
import type { SceneView } from "@/types/story";
import { StoryBackdrop } from "./backdrop";
import { SpeakerPortrait } from "./speaker-portrait";

const CHARS_PER_TICK = 2;
const TICK_MS = 28;

/**
 * Full-screen story scene: pixel backdrop, speaker portrait and a dialogue box
 * with a typewriter effect. Tap / Enter / Space: finish the line or go on;
 * Escape or "Пропустить": skip. With animations off the text appears at once.
 */
export function Cutscene({ scene, onDone }: { scene: SceneView; onDone: () => void }) {
  const motionOff = useUiStore((s) => s.motionOff);
  const sfx = useUiStore((s) => s.sfx);
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState(0);
  const boxRef = useRef<HTMLButtonElement>(null);
  const line = scene.lines[index];
  const full = line?.text ?? "";
  const typing = shown < full.length;

  useEffect(() => {
    boxRef.current?.focus();
  }, []);

  useEffect(() => {
    sfx("blip");
    if (motionOff) {
      setShown(full.length);
      return;
    }
    setShown(0);
    const id = window.setInterval(() => {
      setShown((n) => {
        if (n + CHARS_PER_TICK >= full.length) window.clearInterval(id);
        return Math.min(full.length, n + CHARS_PER_TICK);
      });
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [index, full, motionOff, sfx]);

  const advance = useCallback(() => {
    if (typing) {
      setShown(full.length);
      return;
    }
    if (index + 1 < scene.lines.length) setIndex(index + 1);
    else onDone();
  }, [typing, full.length, index, scene.lines.length, onDone]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDone();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDone]);

  if (!line) return null;
  const narrator = line.speaker === "narrator";

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black anim-fade" role="dialog" aria-modal="true" aria-label={scene.title}>
      {/* Phones in portrait see the whole scene letterboxed; wider screens get it full-bleed. */}
      <StoryBackdrop kind={scene.backdrop} fit="meet" className="absolute inset-x-0 top-[12%] h-[45%] w-full sm:hidden" />
      <StoryBackdrop kind={scene.backdrop} className="absolute inset-0 hidden h-full w-full sm:block" />
      <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/70" aria-hidden />

      <div className="relative flex items-center justify-between gap-2 p-3" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}>
        <span className="pixel-panel bg-bg-deep/80 px-3 py-1 font-display text-xs text-gold">{scene.title}</span>
        <button className="pixel-btn bg-bg-deep/80 px-3 text-xs" onClick={onDone}>
          Пропустить ⏭
        </button>
      </div>

      <div className="relative mt-auto mx-auto w-full max-w-3xl p-3" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
        {!narrator && (
          <div key={`p${index}`} className="mb-2 anim-rise">
            <SpeakerPortrait speaker={line.speaker} name={line.name} size={88} />
          </div>
        )}
        <button
          ref={boxRef}
          onClick={advance}
          className={`pixel-panel block w-full cursor-pointer bg-bg-deep/95 p-4 text-left ${narrator ? "border-gold-dim" : "pixel-panel-gold"}`}
          aria-label={typing ? "Показать реплику целиком" : index + 1 < scene.lines.length ? "Дальше" : "Завершить сцену"}
        >
          {!narrator && <div className="mb-1 font-display text-sm text-gold">{line.name}</div>}
          <p className={`min-h-[4.5rem] text-base leading-relaxed ${narrator ? "italic text-text/90" : ""}`}>
            <span aria-hidden>{full.slice(0, shown)}</span>
            <span className="sr-only">{full}</span>
            {!typing && <span className="anim-caret ml-1 text-gold" aria-hidden>▼</span>}
          </p>
          <div className="mt-2 flex items-center justify-between text-[10px] text-muted font-display">
            <span>
              {index + 1} / {scene.lines.length}
            </span>
            <span>Нажмите, чтобы продолжить</span>
          </div>
        </button>
      </div>
    </div>
  );
}
