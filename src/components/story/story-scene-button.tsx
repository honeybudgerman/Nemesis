"use client";

import { useState } from "react";
import type { SceneView } from "@/types/story";
import { Cutscene } from "./cutscene";

export function StorySceneButton({ scene }: { scene: SceneView }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="pixel-btn mt-2 text-sm" onClick={() => setOpen(true)}>
        Смотреть сцену «{scene.title}»
      </button>
      {open && <Cutscene scene={scene} onDone={() => setOpen(false)} />}
    </>
  );
}
