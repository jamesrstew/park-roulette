"use client";

import { useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/icons";
import { InstallSheet } from "@/components/InstallSheet";
import { installPlatform, markedInstalled } from "@/lib/install";

/** "Make it an app!" card on Me. Opens the install sheet; hidden once installed. */
export function HomeScreenTip({ crewLink }: { crewLink?: string }) {
  const show = useSyncExternalStore(
    () => () => {},
    () => installPlatform() !== "none" && !markedInstalled(),
    () => false,
  );
  const [open, setOpen] = useState(false);
  if (!show) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="doodle-box-alt flex w-full items-center gap-3 bg-crayon-teal/10 px-4 py-3 text-left transition-transform active:scale-[0.98]"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- our own app icon route */}
        <img
          src="/apple-icon"
          alt=""
          width={52}
          height={52}
          className="shrink-0 rounded-[22%] shadow-[2px_3px_0_#2b2a33]"
        />
        <span className="flex-1">
          <span className="block font-hand text-2xl leading-tight">
            Make it an app!
          </span>
          <span className="block text-[0.95rem] leading-snug text-ink-soft">
            Put Park Roulette on your Home Screen. Two taps.
          </span>
        </span>
        <Icon name="arrow_right" size={24} />
      </button>
      <InstallSheet
        open={open}
        onClose={() => setOpen(false)}
        crewLink={crewLink}
      />
    </>
  );
}
