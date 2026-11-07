"use client";

import { useSyncExternalStore } from "react";
import { Icon } from "@/components/icons";
import { onSoundChange, setSoundOn, soundOn } from "@/lib/sound";

export function useSoundOn() {
  return useSyncExternalStore(
    (cb) => onSoundChange(cb),
    soundOn,
    () => true,
  );
}

/** Sound on / off: a little speaker doodle. Compact for headers, or a labeled row. */
export function SoundToggle({ labeled = false }: { labeled?: boolean }) {
  const on = useSoundOn();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={on ? "Sounds on. Tap to mute" : "Sounds off. Tap to turn on"}
      onClick={() => setSoundOn(!on)}
      className={
        labeled
          ? "chip min-h-11 gap-2 text-lg"
          : "grid h-11 w-11 place-items-center rounded-full transition-transform active:scale-90"
      }
    >
      <Icon
        name={on ? "sound_on" : "sound_off"}
        size={labeled ? 24 : 30}
        className={on ? "" : "opacity-70"}
      />
      {labeled && <span>{on ? "Sounds on" : "Sounds off"}</span>}
    </button>
  );
}
