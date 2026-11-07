"use client";

/**
 * The Park Roulette sound box. Every sound is synthesized with WebAudio:
 * no files to download, no licenses, and one consistent "crayon box" voice.
 *
 *   import { sfx } from "@/lib/sound";
 *   sfx.stamp();
 *
 * Sounds respect the in-app toggle (localStorage "pr:sound"), and on iOS 17+
 * the ringer/silent switch (audioSession "ambient"). Browsers only allow audio
 * after a user gesture: every sfx call made from a tap/click unlocks it.
 */

const KEY = "pr:sound";
type Listener = (on: boolean) => void;
const listeners = new Set<Listener>();

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;

export function soundOn(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(KEY) !== "off";
}

export function setSoundOn(on: boolean) {
  localStorage.setItem(KEY, on ? "on" : "off");
  listeners.forEach((l) => l(on));
  if (on) sfx.pop();
}

export function onSoundChange(l: Listener) {
  listeners.add(l);
  return () => void listeners.delete(l);
}

function audio(): AudioContext | null {
  if (typeof window === "undefined" || !soundOn()) return null;
  if (!ctx) {
    // iOS 17+: behave like a game, honor the silent switch.
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    if (nav.audioSession) nav.audioSession.type = "ambient";
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.8;
    // A gentle compressor keeps stacked sounds (confetti + chord) from clipping.
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

// ---------- building blocks ----------

function tone(
  c: AudioContext,
  freq: number,
  {
    at = 0,
    dur = 0.25,
    gain = 0.1,
    type = "sine" as OscillatorType,
    slideTo,
    attack = 0.004,
  }: {
    at?: number;
    dur?: number;
    gain?: number;
    type?: OscillatorType;
    slideTo?: number;
    attack?: number;
  } = {},
) {
  const t = c.currentTime + at;
  const osc = c.createOscillator();
  const amp = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(gain, t + attack);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(amp).connect(master!);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function hiss(
  c: AudioContext,
  {
    at = 0,
    dur = 0.12,
    gain = 0.08,
    freq = 2500,
    q = 1.2,
    type = "bandpass" as BiquadFilterType,
    sweepTo,
  }: {
    at?: number;
    dur?: number;
    gain?: number;
    freq?: number;
    q?: number;
    type?: BiquadFilterType;
    sweepTo?: number;
  } = {},
) {
  const t = c.currentTime + at;
  const src = c.createBufferSource();
  src.buffer = noise;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  f.Q.value = q;
  const amp = c.createGain();
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(amp).connect(master!);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.02);
}

/** Wooden mallet on a bar: sine + quick bright partial. */
function mallet(c: AudioContext, freq: number, at = 0, gain = 0.09) {
  tone(c, freq, { at, dur: 0.45, gain });
  tone(c, freq * 4, { at, dur: 0.1, gain: gain * 0.2 });
  tone(c, freq * 2.76, { at, dur: 0.06, gain: gain * 0.12, type: "triangle" });
}

const PENTA = [0, 2, 4, 7, 9];
/** Step n of a C-major pentatonic scale starting at middle C. */
export function pentatonic(step: number) {
  const octave = Math.floor(step / 5);
  return 261.63 * Math.pow(2, (PENTA[((step % 5) + 5) % 5] + 12 * octave) / 12);
}

// ---------- the sound box ----------

export const sfx = {
  /** Generic tap: a soft wooden "tok". Buttons, chips, tabs. */
  tap() {
    const c = audio();
    if (!c) return;
    tone(c, 520, { dur: 0.07, gain: 0.07, type: "triangle", slideTo: 300 });
    hiss(c, { dur: 0.03, gain: 0.025, freq: 3500 });
  },

  /** Toggle on / chip selected: a bubbly up-pop. */
  pop() {
    const c = audio();
    if (!c) return;
    tone(c, 380, { dur: 0.12, gain: 0.09, slideTo: 900 });
  },

  /** Toggle off: the pop, reversed. */
  unpop() {
    const c = audio();
    if (!c) return;
    tone(c, 700, { dur: 0.12, gain: 0.07, slideTo: 300 });
  },

  /** Wheel peg passing the pointer. `speed` 0..1 brightens it while fast. */
  tick(speed = 0.5) {
    const c = audio();
    if (!c) return;
    tone(c, 1100 + speed * 500, {
      dur: 0.035,
      gain: 0.07,
      type: "triangle",
      slideTo: 500,
    });
    hiss(c, { dur: 0.02, gain: 0.03, freq: 5000 });
  },

  /** Wheel starts: a pencil "zwip". */
  whoosh() {
    const c = audio();
    if (!c) return;
    hiss(c, { dur: 0.35, gain: 0.1, freq: 600, sweepTo: 4000, q: 0.8 });
  },

  /** Wheel lands: a happy little arpeggio. */
  tada() {
    const c = audio();
    if (!c) return;
    [7, 9, 10, 12].forEach((s, i) => mallet(c, pentatonic(s), i * 0.085, 0.08));
    tone(c, pentatonic(12) * 2, {
      at: 0.36,
      dur: 0.5,
      gain: 0.03,
      type: "triangle",
    });
  },

  /** Crayon on paper: a short scribble of filtered noise bursts. */
  scribble(strokes = 3) {
    const c = audio();
    if (!c) return;
    for (let i = 0; i < strokes; i++) {
      hiss(c, {
        at: i * 0.07,
        dur: 0.06 + Math.random() * 0.03,
        gain: 0.06,
        freq: 1800 + Math.random() * 1600,
        q: 2.5,
      });
    }
  },

  /** One tenth on the star crayon: a xylophone note, higher = happier. */
  note(tenths: number) {
    const c = audio();
    if (!c) return;
    mallet(c, pentatonic(Math.round((tenths / 50) * 14)), 0, 0.06);
    hiss(c, { dur: 0.04, gain: 0.02, freq: 2600, q: 3 });
  },

  /** A whole star colored in: a little chord. */
  star(whole: number) {
    const c = audio();
    if (!c) return;
    const base = pentatonic(whole * 2 + 2);
    mallet(c, base, 0, 0.07);
    mallet(c, base * 1.25, 0.05, 0.05);
    mallet(c, base * 1.5, 0.1, 0.05);
  },

  /** Perfect 5.0: a rising fanfare with sparkle. */
  fanfare() {
    const c = audio();
    if (!c) return;
    [10, 12, 14, 15, 17].forEach((s, i) =>
      mallet(c, pentatonic(s), i * 0.08, 0.08),
    );
    for (let i = 0; i < 6; i++)
      tone(c, 2400 + i * 300, {
        at: 0.4 + i * 0.05,
        dur: 0.12,
        gain: 0.02,
        type: "triangle",
      });
  },

  /** Rubber stamp on the passport: a thump plus paper slap. */
  stamp() {
    const c = audio();
    if (!c) return;
    tone(c, 140, { dur: 0.16, gain: 0.22, slideTo: 60 });
    hiss(c, { dur: 0.09, gain: 0.12, freq: 900, q: 0.7, type: "lowpass" });
    hiss(c, { at: 0.02, dur: 0.05, gain: 0.05, freq: 3000 });
  },

  /** Crossing a park off: two quick scratchy strikes. */
  strike() {
    const c = audio();
    if (!c) return;
    hiss(c, { dur: 0.13, gain: 0.08, freq: 1200, sweepTo: 3500, q: 2 });
    hiss(c, {
      at: 0.12,
      dur: 0.11,
      gain: 0.07,
      freq: 3200,
      sweepTo: 1400,
      q: 2,
    });
  },

  /** Undo / put back: a rewind-y slide. */
  undo() {
    const c = audio();
    if (!c) return;
    tone(c, 900, { dur: 0.18, gain: 0.06, type: "triangle", slideTo: 450 });
  },

  /** Sticker earned: a peel, then a bright "ding". */
  sticker() {
    const c = audio();
    if (!c) return;
    hiss(c, { dur: 0.18, gain: 0.06, freq: 2000, sweepTo: 6000, q: 4 });
    mallet(c, pentatonic(12), 0.16, 0.08);
    mallet(c, pentatonic(14), 0.24, 0.07);
  },

  /** A sheet or card sliding up. */
  slide() {
    const c = audio();
    if (!c) return;
    hiss(c, { dur: 0.16, gain: 0.04, freq: 800, sweepTo: 2200, q: 1 });
  },

  /** Camera: a toy shutter click for photo uploads. */
  shutter() {
    const c = audio();
    if (!c) return;
    hiss(c, { dur: 0.03, gain: 0.1, freq: 4000, q: 0.8 });
    hiss(c, { at: 0.06, dur: 0.04, gain: 0.08, freq: 2500, q: 0.8 });
  },

  /** Saved / success: two rising notes. */
  yay() {
    const c = audio();
    if (!c) return;
    mallet(c, pentatonic(7), 0, 0.07);
    mallet(c, pentatonic(9), 0.09, 0.07);
  },

  /** Something went wrong: a soft "boop-boop" down, never harsh. */
  oops() {
    const c = audio();
    if (!c) return;
    tone(c, 330, { dur: 0.12, gain: 0.07, type: "triangle" });
    tone(c, 262, { at: 0.13, dur: 0.18, gain: 0.07, type: "triangle" });
  },

  /** A whole town or the whole list finished: the big one. */
  celebrate() {
    const c = audio();
    if (!c) return;
    [0, 2, 4, 5, 7, 9, 10, 12].forEach((s, i) =>
      mallet(c, pentatonic(s + 5), i * 0.07, 0.07),
    );
    [5, 9, 12].forEach((s) =>
      tone(c, pentatonic(s + 5), {
        at: 0.62,
        dur: 1,
        gain: 0.04,
        type: "triangle",
        attack: 0.02,
      }),
    );
  },
};

export type SfxName = keyof typeof sfx;
