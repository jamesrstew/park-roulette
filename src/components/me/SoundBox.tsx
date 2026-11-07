"use client";

import { Icon, type IconName } from "@/components/icons";
import { sfx, type SfxName } from "@/lib/sound";
import { SoundToggle, useSoundOn } from "../SoundToggle";

const SAMPLES: {
  name: SfxName;
  label: string;
  icon: IconName;
  arg?: number;
}[] = [
  { name: "whoosh", label: "Spin", icon: "spin" },
  { name: "tick", label: "Tick", icon: "nature", arg: 0.6 },
  { name: "tada", label: "Ta-da", icon: "party" },
  { name: "stamp", label: "Stamp", icon: "stamp" },
  { name: "star", label: "A star", icon: "star", arg: 4 },
  { name: "fanfare", label: "Perfect 5", icon: "crown" },
  { name: "scribble", label: "Scribble", icon: "crayon" },
  { name: "strike", label: "Cross off", icon: "close" },
  { name: "sticker", label: "Sticker", icon: "sparkles" },
  { name: "shutter", label: "Photo", icon: "camera" },
  { name: "yay", label: "Saved", icon: "mail" },
  { name: "celebrate", label: "Town done", icon: "trophy" },
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
            className="chip min-h-16 flex-col justify-center gap-0.5 px-1 text-sm"
          >
            <Icon name={s.icon} size={26} />
            {s.label}
          </button>
        ))}
      </div>
    </section>
  );
}
