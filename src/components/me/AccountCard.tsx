"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ErrorLine } from "@/components/ErrorLine";
import { Icon } from "@/components/icons";
import { deleteFamily, deleteMe, removeKid } from "@/lib/client-actions";
import { sfx } from "@/lib/sound";

type Kid = { id: number; name: string };
type Ask = null | "me" | "family" | { kid: Kid };

/**
 * The fine print and the exits: Terms, Privacy, contact, and deleting a
 * kid, yourself or your whole family. Grown-ups who signed in properly only.
 */
export function AccountCard({
  canDelete,
  kids,
  lastGrownUp,
  familyName,
}: {
  canDelete: boolean;
  kids: Kid[];
  lastGrownUp: boolean;
  familyName: string;
}) {
  const [ask, setAsk] = useState<Ask>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const confirmText =
    ask === "me"
      ? lastGrownUp
        ? `You're the last grown-up in ${familyName}, so this deletes the whole family: every stamp, review and photo. It can't be undone.`
        : "This deletes your reviews and photos. Your family keeps its stamps. It can't be undone."
      : ask === "family"
        ? `This deletes ${familyName}: everyone in it, every stamp, review and photo. It can't be undone.`
        : ask
          ? `This removes ${ask.kid.name} and their reviews. Your family keeps its stamps.`
          : "";

  function go() {
    if (!ask) return;
    setError(null);
    start(async () => {
      const r =
        ask === "me"
          ? await deleteMe()
          : ask === "family"
            ? await deleteFamily()
            : await removeKid(ask.kid.id);
      if (!r.ok) return (sfx.oops(), setError(r.error));
      setAsk(null);
    });
  }

  return (
    <section
      aria-labelledby="account-h"
      className="doodle-box-alt flex flex-col gap-3 px-4 py-4"
    >
      <h2 id="account-h" className="flex items-center gap-2 font-hand text-2xl">
        <Icon name="lock" size={28} /> Privacy &amp; your account
      </h2>
      <p className="text-sm leading-snug">
        Photos only show to signed-in families. Your passport and number are
        just yours. Questions?{" "}
        <a href="mailto:hello@parkroulette.quest" className="underline">
          hello@parkroulette.quest
        </a>
      </p>
      <p className="flex gap-4 text-sm">
        <Link href="/privacy" className="min-h-11 underline underline-offset-2">
          Privacy Policy
        </Link>
        <Link href="/terms" className="min-h-11 underline underline-offset-2">
          Terms
        </Link>
      </p>

      {canDelete && !ask && (
        <div className="flex flex-col items-start gap-1 border-t-2 border-dashed border-ink/15 pt-2">
          {kids.map((k) => (
            <button
              key={k.id}
              type="button"
              onClick={() => setAsk({ kid: k })}
              className="min-h-11 text-sm text-ink-soft underline underline-offset-2"
            >
              Remove {k.name}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setAsk("me")}
            className="min-h-11 text-sm text-ink-soft underline underline-offset-2"
          >
            Delete me
          </button>
          <button
            type="button"
            onClick={() => setAsk("family")}
            className="min-h-11 text-sm text-ink-soft underline underline-offset-2"
          >
            Delete our whole family
          </button>
        </div>
      )}

      {ask && (
        <div
          className="flex animate-pop-in flex-col gap-2"
          role="alertdialog"
          aria-label="Are you sure?"
        >
          <p className="leading-snug">{confirmText}</p>
          {error && <ErrorLine>{error}</ErrorLine>}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setAsk(null)}
              className="crayon-btn min-h-12 flex-1 bg-[#fffdf7] text-xl"
            >
              Keep it
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={go}
              className="crayon-btn wax min-h-12 flex-1 bg-crayon-red text-xl text-white"
            >
              {pending ? "Deleting…" : "Delete"}
            </button>
          </div>
        </div>
      )}

      {!canDelete && (
        <p className="text-xs leading-snug text-ink-soft">
          To delete anything, sign in as a grown-up with your number (or on the
          phone you joined with), or email us.
        </p>
      )}
    </section>
  );
}
