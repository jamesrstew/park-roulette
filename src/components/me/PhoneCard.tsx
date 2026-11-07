"use client";

import { useEffect, useState } from "react";
import { ErrorLine } from "@/components/ErrorLine";
import { Icon } from "@/components/icons";
import { PhoneCode } from "@/components/PhoneCode";
import { removePhone } from "@/lib/client-actions";
import { sfx } from "@/lib/sound";

/**
 * Me: the number that signs you in. No number yet: a friendly nudge to add
 * one (it's how you get back in on any phone). Has one: change or remove it.
 * Signed in by a family link or a switch (kids, shared phones): numbers can't
 * be added from here, so say why instead of offering a form that would fail.
 */
export function PhoneCard({
  phone,
  trusted,
  name,
}: {
  phone: string | null;
  trusted: boolean;
  name: string;
}) {
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(null), 6000);
    return () => clearTimeout(t);
  }, [saved]);

  const onSaved = (shown: string) => {
    setEditing(false);
    setSaved(shown);
  };

  if (!phone && !trusted)
    return (
      <section className="doodle-box-alt flex items-start gap-3 px-4 py-3">
        <Icon name="phone" size={34} />
        <p className="leading-snug">
          <b className="font-hand text-xl font-normal">No number for {name}.</b>{" "}
          Kids don&apos;t need one! Grown-up? Add yours on the phone you joined
          with.
        </p>
      </section>
    );

  if (!phone)
    return (
      <section
        aria-labelledby="phone-h"
        className="doodle-box wax relative bg-crayon-green/15 px-5 pt-5 pb-4 shadow-[3px_4px_0_#2b2a33]"
      >
        <span className="tape -top-3 right-8 rotate-3" aria-hidden />
        <div className="flex items-start gap-3">
          <span className="animate-float">
            <Icon name="phone" size={44} />
          </span>
          <div>
            <h2 id="phone-h" className="text-3xl leading-tight">
              Sign in on any phone
            </h2>
            <p className="leading-snug">
              Add your number and you can always hop back in with a text. New
              phone, Home Screen app, anywhere. Kids don&apos;t need one.
            </p>
          </div>
        </div>
        <div className="mt-3">
          {editing ? (
            <PhoneCode
              mode="add"
              autoFocus
              onDone={onSaved}
              onSkip={() => setEditing(false)}
              skipLabel="Skip it"
            />
          ) : (
            <button
              type="button"
              onClick={() => (setEditing(true), sfx.tap())}
              className="crayon-btn wax w-full bg-crayon-green py-3 text-2xl text-white [text-shadow:1px_1px_0_#2b2a33]"
            >
              Add my number
            </button>
          )}
        </div>
      </section>
    );

  return (
    <section
      aria-labelledby="phone-h"
      className="doodle-box-alt flex flex-col gap-2 px-4 py-3"
    >
      <div className="flex items-center gap-3">
        <Icon name="phone" size={34} />
        <div className="min-w-0 flex-1">
          <h2 id="phone-h" className="font-hand text-2xl leading-tight">
            You sign in with
          </h2>
          <p className="truncate text-lg">{phone}</p>
        </div>
        {!editing && !sure && trusted ? (
          <button
            type="button"
            onClick={() => (setEditing(true), setSaved(null))}
            className="chip min-h-11 shrink-0"
          >
            Change
          </button>
        ) : null}
      </div>

      {saved ? (
        <p
          role="status"
          className="flex animate-pop-in items-start gap-2 font-hand text-xl leading-tight"
        >
          <Icon name="check" size={24} className="shrink-0" />
          Saved! Other phones will ask for it once.
        </p>
      ) : null}

      {editing ? (
        <div className="mt-1">
          <PhoneCode
            mode="add"
            autoFocus
            submitLabel="Text my new number"
            onDone={onSaved}
            onSkip={() => setEditing(false)}
            skipLabel="Never mind"
          />
        </div>
      ) : sure ? (
        <div className="flex animate-pop-in flex-col gap-2 text-center">
          <p className="leading-snug">
            Remove it? You&apos;ll be signed out on your other phones, and
            getting back in will take your family link.
          </p>
          {error ? <ErrorLine>{error}</ErrorLine> : null}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setSure(false)}
              className="crayon-btn flex-1 bg-[#fffdf7] text-xl"
            >
              Keep it
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const r = await removePhone();
                setBusy(false);
                if (r.ok) setSure(false);
                else setError(r.error);
              }}
              className="crayon-btn wax flex-1 bg-crayon-red text-xl text-white"
            >
              Remove
            </button>
          </div>
        </div>
      ) : trusted ? (
        <button
          type="button"
          onClick={() => setSure(true)}
          className="min-h-11 self-start text-sm text-ink-soft underline underline-offset-2"
        >
          Remove my number
        </button>
      ) : null}
    </section>
  );
}
