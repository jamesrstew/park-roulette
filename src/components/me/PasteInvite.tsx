"use client";

import { useRouter } from "next/navigation";
import { ErrorLine } from "@/components/ErrorLine";
import { useId, useState } from "react";

/** Pull the code out of a pasted invite link (or accept a bare code). */
export function inviteCodeFrom(text: string): string | null {
  const t = text.trim();
  const m =
    t.match(/\/join\/([a-z0-9-]{4,80})/i) ?? t.match(/^([a-z0-9-]{4,80})$/i);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Paste an invite link: for new people whose link opened somewhere odd
 * (a Home Screen app, Instagram's or Messenger's own browser), and for
 * explorers without a phone number getting back in.
 */
export function PasteInvite({
  label = "Got an invite link? Paste it here:",
}: {
  label?: string;
}) {
  const id = useId();
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex w-full flex-col gap-2 text-left"
      onSubmit={(e) => {
        e.preventDefault();
        const code = inviteCodeFrom(text);
        if (!code)
          return setError("Hmm, that doesn't look like a Park Roulette link.");
        router.push(`/join/${code}`);
      }}
    >
      <label htmlFor={id} className="font-hand text-xl">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          className="field min-w-0 flex-1"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="…/join/wiggly-otter-…"
          value={text}
          onChange={(e) => (setText(e.target.value), setError(null))}
        />
        <button
          type="submit"
          className="crayon-btn wax shrink-0 bg-crayon-green px-4 text-white"
        >
          Go
        </button>
      </div>
      {error && <ErrorLine>{error}</ErrorLine>}
    </form>
  );
}
