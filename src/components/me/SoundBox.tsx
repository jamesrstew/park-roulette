"use client";

import { sfx, type SfxName } from "@/lib/sound";
import { SoundToggle, useSoundOn } from "../SoundToggle";

const SAMPLES: { name: SfxName; label: string; emoji: string; arg?: number }[] =
  [
    { name: "whoosh", label: "Spin", emoji: "🎡" },
    { name: "tick", label: "Tick", emoji: "🪵", arg: 0.6 },
    { name: "tada", label: "Ta-da", emoji: "🎉" },
    { name: "stamp", label: "Stamp", emoji: "📒" },
    { name: "star", label: "A star", emoji: "⭐", arg: 4 },
    { name: "fanfare", label: "Perfect 5", emoji: "🤩" },
    { name: "scribble", label: "Scribble", emoji: "🖍️" },
    { name: "strike", label: "Cross off", emoji: "✗" },
    { name: "sticker", label: "Sticker", emoji: "🏅" },
    { name: "shutter", label: "Photo", emoji: "📷" },
    { name: "yay", label: "Saved", emoji: "💌" },
    { name: "celebrate", label: "Town done", emoji: "🏆" },
  ];

/** The sound toggle, plus a little box of sounds to try. */
export function SoundBox() {
  const on = useSoundOn();
  return (
    <section className="doodle-box flex flex-col gap-3 p-4" aria-label="Sounds">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-3xl">Sound box</h2>
        <SoundToggle labeled />
      </div>
      <p className="text-sm text-ink-soft">
        Little crayon sounds for spins, stamps and stars. They follow your
        phone&apos;s silent switch on newer iPhones.
      </p>
      <div
        className={`grid grid-cols-4 gap-2 ${on ? "" : "pointer-events-none opacity-40"}`}
      >
        {SAMPLES.map((s) => (
          <button
            key={s.name}
            type="button"
            onClick={() => (sfx[s.name] as (a?: number) => void)(s.arg)}
            className="chip min-h-14 flex-col justify-center gap-0 px-1 text-sm"
          >
            <span className="text-xl" aria-hidden>
              {s.emoji}
            </span>
            {s.label}
          </button>
        ))}
      </div>
    </section>
  );
}
