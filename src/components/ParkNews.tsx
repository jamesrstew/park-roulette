"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { ErrorLine } from "@/components/ErrorLine";
import { Icon } from "@/components/icons";
import {
  resendParkNewsConfirmation,
  signUpForEmail,
  stopParkNews,
} from "@/lib/client-actions";
import type { SignupSource } from "@/lib/news/subscribers";
import { cleanEmail, PARK_NEWS, suggestEmail } from "@/lib/park-news";
import { sfx } from "@/lib/sound";

/**
 * The email signup, the same everywhere (footer, /newsletter, issue pages,
 * onboarding, settings): a labeled field, "Count us in!", the fine print,
 * and a honeypot. The reply is the same whether or not the address is
 * already on the list ("Almost there!"); only a bad address differs.
 */
export function EmailSignup({
  source,
  initial = "",
  fine = PARK_NEWS.fine,
  inline = false,
  autoFocus = false,
  onDone,
}: {
  source: SignupSource;
  initial?: string;
  /** The fine print under the field. */
  fine?: string;
  /** Field and button side by side on wider screens (the footer). */
  inline?: boolean;
  autoFocus?: boolean;
  /** Called after a good reply, with the address (settings, onboarding). */
  onDone?: (email: string) => void;
}) {
  const id = useId();
  const [email, setEmail] = useState(initial);
  const [trap, setTrap] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  /** Offer the typo fix once; a second press sends it as typed. */
  const [hinted, setHinted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!cleanEmail(email)) return setError("That email looks off. Try again?");
    const fix = suggestEmail(email);
    if (fix && !hinted) {
      setHint(fix);
      setHinted(true);
      return;
    }
    start(async () => {
      const r = await signUpForEmail(email, source, trap);
      if (!r.ok) return (sfx.oops(), setError(r.error));
      sfx.pop();
      setDone(true);
      onDone?.(cleanEmail(email) ?? email);
    });
  };
  if (done && !onDone)
    return (
      <p
        role="status"
        className="flex animate-pop-in items-center gap-2 font-hand text-xl leading-snug"
      >
        <Icon name="mail" size={28} /> {PARK_NEWS.success}
      </p>
    );
  return (
    <form onSubmit={submit} className="flex flex-col gap-2" noValidate>
      <label htmlFor={id} className="sr-only">
        Your email
      </label>
      <div className={inline ? "flex flex-row gap-2" : "contents"}>
        <input
          id={id}
          className="field min-w-0 flex-1 text-base"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="send"
          maxLength={254}
          placeholder="you@example.com"
          autoFocus={autoFocus}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-err` : `${id}-fine`}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setHint(null);
            setHinted(false);
            setError(null);
          }}
          onBlur={() => setHint(suggestEmail(email))}
        />
        <button
          type="submit"
          disabled={pending}
          className="crayon-btn wax min-h-12 shrink-0 bg-crayon-blue px-5 text-xl text-white [text-shadow:1px_1px_0_#2b2a33]"
        >
          {pending ? PARK_NEWS.pending : PARK_NEWS.button}
        </button>
      </div>
      {/* The honeypot: hidden from people and screen readers, not from bots. */}
      <div
        aria-hidden="true"
        className="absolute -left-[9999px] h-px w-px overflow-hidden"
      >
        <label>
          Website
          <input
            tabIndex={-1}
            autoComplete="off"
            name="website"
            value={trap}
            onChange={(e) => setTrap(e.target.value)}
          />
        </label>
      </div>
      <div aria-live="polite">
        {hint ? (
          <button
            type="button"
            onClick={() => (setEmail(hint), setHint(null))}
            className="chip min-h-11 self-start text-sm"
          >
            <span>
              Did you mean <b className="font-semibold">{hint}</b>?
            </span>
          </button>
        ) : null}
      </div>
      {error ? <ErrorLine id={`${id}-err`}>{error}</ErrorLine> : null}
      <p id={`${id}-fine`} className="text-sm leading-snug text-ink-soft">
        {fine}{" "}
        <Link href="/privacy#park-news" className="underline">
          Privacy
        </Link>
      </p>
    </form>
  );
}

type EmailState = { status: "off" | "pending" | "on"; address: string | null };

/**
 * Family & settings: Park picks, one card with an email row and a text row
 * (the text row comes from the server page, as `texts`).
 */
export function ParkPicksSettings({
  email,
  trusted,
  texts,
}: {
  /** This account's email state (never "already subscribed"). */
  email: EmailState;
  trusted: boolean;
  texts?: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby="park-picks-h"
      className="doodle-box-alt flex flex-col gap-3 px-4 py-3"
    >
      <h2
        id="park-picks-h"
        className="flex items-center gap-2 font-hand text-2xl leading-tight"
      >
        <Icon name="mail" size={30} /> {PARK_NEWS.title}
      </h2>
      <EmailRow email={email} trusted={trusted} />
      {texts}
    </section>
  );
}

function EmailRow({ email, trusted }: { email: EmailState; trusted: boolean }) {
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [saved, setSaved] = useState<string | null>(null);
  const [waitingFor, setWaitingFor] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const status = stopped ? "off" : waitingFor ? "pending" : email.status;
  const address = waitingFor ?? email.address;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-hand text-xl leading-tight">
        Bend Playground Passport{" "}
        <span className="font-body text-sm text-ink-soft">
          · Thursday mornings
        </span>
      </h3>
      {!trusted ? (
        status === "off" ? (
          <p className="leading-snug">
            Sign in with your own number to get the weekly email.
          </p>
        ) : (
          <>
            <p className="leading-snug">
              {status === "on" ? PARK_NEWS.on : PARK_NEWS.waiting}
            </p>
            <StopButton
              onStopped={() => (setStopped(true), setSaved("Emails off."))}
            />
          </>
        )
      ) : mode === "edit" ? (
        <>
          <EmailSignup
            source="settings"
            initial={address ?? ""}
            fine="We'll email you a link to confirm."
            autoFocus
            onDone={(a) => {
              setMode("view");
              setStopped(false);
              setWaitingFor(a);
              setSaved("Almost there! Check your email.");
            }}
          />
          <button
            type="button"
            onClick={() => setMode("view")}
            className="min-h-11 self-start text-sm text-ink-soft underline underline-offset-2"
          >
            Never mind
          </button>
        </>
      ) : status === "off" ? (
        <>
          <p className="leading-snug">{PARK_NEWS.off}</p>
          <button
            type="button"
            onClick={() => (setMode("edit"), setSaved(null))}
            className="chip min-h-11 self-start"
          >
            Get the weekly email
          </button>
        </>
      ) : (
        <>
          <div className="flex min-h-11 items-center gap-3">
            <p className="min-w-0 flex-1 truncate">{address}</p>
            <button
              type="button"
              onClick={() => (setMode("edit"), setSaved(null))}
              className="chip min-h-11 shrink-0"
            >
              Change
            </button>
          </div>
          {status === "on" ? (
            <p className="text-sm text-ink-soft">{PARK_NEWS.on}</p>
          ) : (
            <ResendLink onSent={() => setSaved("Sent! Check your email.")} />
          )}
          <StopButton
            onStopped={() => (setStopped(true), setSaved("Emails off."))}
          />
        </>
      )}
      {saved ? (
        <p
          role="status"
          className="flex animate-pop-in items-center gap-2 font-hand text-xl"
        >
          <Icon name="check" size={24} /> {saved}
        </p>
      ) : null}
    </div>
  );
}

/** Waiting to confirm: the reminder, and another link if the first got lost. */
export function ResendLink({ onSent }: { onSent: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <p className="text-sm leading-snug text-ink-soft">{PARK_NEWS.waiting}</p>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await resendParkNewsConfirmation();
            if (!r.ok) return setError(r.error);
            onSent();
          })
        }
        className="chip min-h-11 self-start"
      >
        {pending ? PARK_NEWS.pending : "Send the link again"}
      </button>
      {error ? <ErrorLine>{error}</ErrorLine> : null}
    </>
  );
}

/** "Stop emails": one tap, no confirm step, works in any grown-up session. */
function StopButton({ onStopped }: { onStopped: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await stopParkNews();
            if (!r.ok) return setError(r.error);
            onStopped();
          })
        }
        className="min-h-11 self-start text-sm text-ink-soft underline underline-offset-2"
      >
        Stop emails
      </button>
      {error ? <ErrorLine>{error}</ErrorLine> : null}
    </>
  );
}
