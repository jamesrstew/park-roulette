"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { PhoneCode } from "@/components/PhoneCode";
import { storage } from "@/lib/storage";

export const PHONE_NUDGE_KEY = "pr:phone-nudge";
const KEY = PHONE_NUDGE_KEY;

/**
 * Once, on Spin, for grown-ups who joined before phone sign-in (or skipped
 * it): "Sign in on any phone." Top-anchored, so the keyboard never
 * covers the field. Never shown with the welcome sheet.
 */
export function PhoneNudge() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("welcome")) return;
    // Checked when the timer fires: the welcome sheet marks it done meanwhile.
    const t = setTimeout(() => {
      if (!storage.get(KEY)) setOpen(true);
    }, 1500);
    return () => clearTimeout(t);
  }, []);

  const close = () => {
    storage.set(KEY, String(Date.now()));
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[1200] flex items-start justify-center">
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={close}
        className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="nudge-h"
        className="doodle-box relative mx-3 mt-[max(env(safe-area-inset-top),1rem)] w-full max-w-md animate-pop-in px-5 pt-5 pb-4 shadow-[4px_6px_0_#2b2a33]"
      >
        <div className="mb-2 flex items-start gap-3">
          <span className="animate-float">
            <Icon name="phone" size={44} />
          </span>
          <div>
            <h2 id="nudge-h" className="text-3xl leading-tight">
              Sign in on any phone
            </h2>
            <p className="leading-snug">
              Add your number and you can always hop back in with a text. Kids
              can skip this.
            </p>
          </div>
        </div>
        <PhoneCode
          mode="add"
          onDone={() => setTimeout(close, 1800)}
          onSkip={close}
          skipLabel="Skip for now"
        />
      </div>
    </div>
  );
}
