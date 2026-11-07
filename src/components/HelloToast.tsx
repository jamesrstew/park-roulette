"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";

const KEY = "pr:hello";
const CANCEL = "pr:hello-cancel";

/** A bigger moment is happening (the app's first launch): skip the hello. */
export function cancelHello() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {}
  window.dispatchEvent(new Event(CANCEL));
}

/** Leave a hello for the next page (sign-in reloads the app). */
export function sayHello(message: string) {
  try {
    sessionStorage.setItem(KEY, message);
  } catch {}
}

/**
 * "Welcome back, Mom!" A small, quick note after signing in. Not the full
 * first-time welcome: they know the game already.
 */
export function HelloToast() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let m: string | null = null;
    try {
      m = sessionStorage.getItem(KEY);
      sessionStorage.removeItem(KEY);
    } catch {}
    if (!m) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot note from the previous page
    setMessage(m.slice(0, 80));
    // No sound: this is a fresh page with no tap yet, so iPhones would block
    // it anyway (the sign-in screen already cheered).
    const hide = () => setMessage(null);
    const t = setTimeout(hide, 3500);
    window.addEventListener(CANCEL, hide);
    return () => {
      clearTimeout(t);
      window.removeEventListener(CANCEL, hide);
    };
  }, []);

  if (!message) return null;
  return (
    <div
      role="status"
      className="doodle-box fixed inset-x-4 top-[max(env(safe-area-inset-top),1rem)] z-[1300] mx-auto flex max-w-md animate-pop-in items-center justify-center gap-2 bg-[#fffdf7] px-4 py-3 shadow-[3px_4px_0_#2b2a33]"
    >
      <span className="animate-wiggle">
        <Icon name="sparkles" size={30} />
      </span>
      <p className="font-hand text-2xl">{message}</p>
    </div>
  );
}
