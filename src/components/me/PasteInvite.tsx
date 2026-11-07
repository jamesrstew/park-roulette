"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Pull the code out of a pasted invite link (or accept a bare code). */
export function inviteCodeFrom(text: string): string | null {
  const t = text.trim();
  const m =
    t.match(/\/join\/([a-z0-9-]{4,80})/i) ?? t.match(/^([a-z0-9-]{4,80})$/i);
  return m ? m[1].toLowerCase() : null;
}

/**
 * For people whose cookies didn't come along: a Home Screen app, or a link
 * that opened in Instagram's or Messenger's own browser. Paste the link here.
 */
export function PasteInvite() {
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
          return setError("Hmm, that doesn't look like an invite link.");
        router.push(`/join/${code}`);
      }}
    >
      <label htmlFor="paste-invite" className="font-hand text-xl">
        Have an invite link? Paste it here:
      </label>
      <div className="flex gap-2">
        <input
          id="paste-invite"
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
      {error && (
        <p role="alert" className="font-hand text-lg text-crayon-red">
          {error}
        </p>
      )}
    </form>
  );
}
