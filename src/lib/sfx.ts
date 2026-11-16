/**
 * Tiny 8-bit sound effects synthesised with WebAudio: no audio files to load.
 * Silent on the server, in browsers without WebAudio, and until the first user
 * gesture (browsers block audio before it). Callers decide whether sound is on.
 */
export const SFX = ["click", "blip", "success", "fail", "levelup", "victory", "defeat", "unlock"] as const;
export type Sfx = (typeof SFX)[number];

type Wave = "square" | "triangle" | "sawtooth" | "sine";
/** [frequency Hz, start s, duration s] */
type Note = readonly [number, number, number];

export const SOUNDS: Readonly<Record<Sfx, { wave: Wave; gain: number; notes: readonly Note[] }>> = {
  click: { wave: "square", gain: 0.04, notes: [[660, 0, 0.03]] },
  blip: { wave: "square", gain: 0.03, notes: [[880, 0, 0.025]] },
  success: { wave: "square", gain: 0.05, notes: [[523, 0, 0.08], [784, 0.08, 0.12]] },
  fail: { wave: "triangle", gain: 0.07, notes: [[220, 0, 0.12], [165, 0.12, 0.2]] },
  levelup: { wave: "square", gain: 0.05, notes: [[523, 0, 0.09], [659, 0.09, 0.09], [784, 0.18, 0.09], [1047, 0.27, 0.25]] },
  victory: { wave: "square", gain: 0.05, notes: [[392, 0, 0.12], [523, 0.12, 0.12], [659, 0.24, 0.12], [784, 0.36, 0.12], [659, 0.48, 0.1], [784, 0.58, 0.35]] },
  defeat: { wave: "triangle", gain: 0.07, notes: [[392, 0, 0.18], [349, 0.18, 0.18], [311, 0.36, 0.18], [262, 0.54, 0.45]] },
  unlock: { wave: "square", gain: 0.045, notes: [[988, 0, 0.07], [1319, 0.07, 0.18]] },
};

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!C) return null;
    try {
      ctx = new C();
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  return ctx;
}

export function playSfx(name: Sfx): void {
  const a = audio();
  if (!a) return;
  const s = SOUNDS[name];
  const t0 = a.currentTime + 0.01;
  for (const [freq, start, dur] of s.notes) {
    const osc = a.createOscillator();
    const g = a.createGain();
    osc.type = s.wave;
    osc.frequency.setValueAtTime(freq, t0 + start);
    g.gain.setValueAtTime(0, t0 + start);
    g.gain.linearRampToValueAtTime(s.gain, t0 + start + 0.005);
    g.gain.setValueAtTime(s.gain, t0 + start + dur * 0.7);
    g.gain.linearRampToValueAtTime(0, t0 + start + dur);
    osc.connect(g).connect(a.destination);
    osc.start(t0 + start);
    osc.stop(t0 + start + dur + 0.02);
  }
}
