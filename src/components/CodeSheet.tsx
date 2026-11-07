"use client";

import { useEffect } from "react";
import { AvatarBlob } from "@/components/me/NameTag";

/**
 * A small sheet for typing a texted code ("That's me!", "Who's playing?").
 * Top-anchored, so the iPhone keyboard never covers the code.
 */
export function CodeSheet({
  title,
  avatar,
  color,
  onClose,
  children,
}: {
  title: string;
  avatar: string;
  color: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[1250] flex items-start justify-center">
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="code-sheet-h"
        className="doodle-box relative mx-3 mt-[max(env(safe-area-inset-top),1rem)] w-full max-w-md animate-pop-in px-5 pt-5 pb-4 shadow-[4px_6px_0_#2b2a33]"
      >
        <div className="mb-3 flex items-center gap-3">
          <AvatarBlob avatar={avatar} color={color} />
          <h2 id="code-sheet-h" className="font-hand text-3xl leading-tight">
            {title}
          </h2>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Focus the code field of a sheet that was just opened (inside the tap). */
export function focusClaimCode() {
  document.getElementById("code-claim")?.focus();
}
