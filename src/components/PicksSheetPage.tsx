"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { ErrorLine } from "@/components/ErrorLine";
import { Icon } from "@/components/icons";
import {
  dismissParkNews,
  signUpForEmail,
  turnOnTexts,
} from "@/lib/client-actions";
import { cleanEmail, NEWS_NAME, PARK_NEWS } from "@/lib/park-news";
import { sfx } from "@/lib/sound";
import {
  prettyPhone,
  checkboxLine,
  TEXTS_CONSENT_TEXT,
  TEXTS_CONSENT_VERSION,
} from "@/lib/texts";

/**
 * The welcome sheet's one ask: "Want the weekly park picks?" Two big rows,
 * collapsed (email on Thursday mornings, a text on Friday afternoons);
 * tapping one opens it in place. The text row shows the full disclosure
 * under the box before it can be checked. One button, never disabled.
 * "Not now" (and Escape, and the backdrop) never asks again.
 */
export function PicksSheetPage({
  phone,
  textsSendingOn,
  headingId,
  onFinish,
}: {
  /** This grown-up's number (E.164), just proven by a code. */
  phone: string;
  textsSendingOn: boolean;
  headingId: string;
  onFinish: () => void;
}) {
  const id = useId();
  const words = TEXTS_CONSENT_TEXT[TEXTS_CONSENT_VERSION];
  const [open, setOpen] = useState({ email: false, text: false });
  const [email, setEmail] = useState("");
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{
    email: string | null;
    texts: boolean;
  } | null>(null);
  const [pending, start] = useTransition();
  const emailRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (open.email) emailRef.current?.focus();
  }, [open.email]);
  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);

  const notNow = () => {
    void dismissParkNews();
    onFinish();
  };
  const submit = () =>
    start(async () => {
      setError(null);
      const wantsEmail = open.email && email.trim() !== "";
      const wantsText = open.text && checked;
      if (!wantsEmail && !wantsText)
        return setError("Add your email or check the box first.");
      if (wantsEmail && !cleanEmail(email))
        return setError("That email looks off. Try again?");
      let mailed: string | null = null;
      if (wantsEmail) {
        const r = await signUpForEmail(email, "welcome_sheet");
        if (!r.ok) return setError(r.error);
        mailed = cleanEmail(email);
      }
      let texts = false;
      if (wantsText) {
        const r = await turnOnTexts("welcome_sheet", "/", {
          agreed: true,
          version: TEXTS_CONSENT_VERSION,
          checkbox: checkboxLine(TEXTS_CONSENT_VERSION, phone),
          disclosure: words.disclosure,
        });
        // A number without a code in 30 days: settings texts a code first.
        if (!r.ok && "reason" in r && r.reason === "code")
          return setError(
            "Texts need a quick code first. Turn them on in Family & settings.",
          );
        if (!r.ok) return setError(r.error);
        texts = r.state === "on" || r.state === "already";
      }
      if (!wantsEmail) void dismissParkNews();
      sfx.pop();
      setDone({ email: mailed, texts });
    });

  if (done)
    return (
      <div className="flex flex-col gap-3">
        <h2
          id={headingId}
          ref={doneRef}
          tabIndex={-1}
          className="font-hand text-4xl leading-tight outline-none"
        >
          {done.email ? "You're in!" : "You're all set!"}
        </h2>
        {done.email ? (
          <p className="flex items-start gap-2 leading-snug">
            <Icon name="mail" size={26} className="shrink-0" />
            <span>
              <b>Email:</b> look for us Thursday morning at{" "}
              <b className="break-all">{done.email}</b>.{" "}
              <Link href="/me#park-picks-h" className="underline">
                Wrong address? Fix it
              </Link>
            </span>
          </p>
        ) : null}
        {done.texts ? (
          <p className="flex items-start gap-2 leading-snug">
            <Icon name="check" size={26} className="shrink-0" />
            <span>
              <b>Texts:</b>{" "}
              {textsSendingOn
                ? "you're in. Watch for one now."
                : "you're in. They start soon."}
            </span>
          </p>
        ) : null}
        <p className="text-sm text-ink-soft">
          Change either one anytime in Family &amp; settings.
        </p>
        <button
          type="button"
          onClick={onFinish}
          className="crayon-btn wax mt-1 w-full bg-crayon-yellow py-3.5 text-3xl"
        >
          Let&apos;s spin!
        </button>
      </div>
    );

  const row = (
    which: "email" | "text",
    icon: "mail" | "phone",
    label: string,
    when: string,
    color: string,
  ) => (
    <button
      type="button"
      aria-expanded={open[which]}
      aria-controls={`${id}-${which}`}
      onClick={() => setOpen((o) => ({ ...o, [which]: !o[which] }))}
      className="flex min-h-[60px] w-full items-center gap-3 border-t border-dashed border-ink/25 py-2 text-left"
    >
      <Icon name={icon} size={34} className={color} />
      <span className="font-hand text-2xl">{label}</span>
      <span className="text-sm text-ink-soft">· {when}</span>
    </button>
  );

  return (
    <div className="flex flex-col gap-2">
      <h2 id={headingId} className="font-hand text-4xl leading-tight">
        Want the weekly park picks?
      </h2>
      <p className="-mt-1 leading-snug">Free, and you can stop anytime.</p>
      {row(
        "email",
        "mail",
        "By email",
        "Thursday mornings",
        "text-crayon-blue",
      )}
      {open.email ? (
        <div id={`${id}-email`} className="flex flex-col gap-2 pb-2">
          <p className="leading-snug">
            {NEWS_NAME}: the forecast, a park to try and a warm backup.
          </p>
          <label htmlFor={`${id}-e`} className="sr-only">
            Your email
          </label>
          <input
            ref={emailRef}
            id={`${id}-e`}
            className="field text-base"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="you@example.com"
            value={email}
            onChange={(e) => (setEmail(e.target.value), setError(null))}
          />
          <p className="text-sm text-ink-soft">
            Thursday mornings. Unsubscribe anytime.
          </p>
        </div>
      ) : null}
      {row(
        "text",
        "phone",
        "By text",
        "Friday afternoons",
        "text-crayon-green",
      )}
      {open.text ? (
        <div id={`${id}-text`} className="flex flex-col gap-2 pb-2">
          <label className="flex min-h-11 cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 size-7 shrink-0 accent-crayon-green"
              checked={checked}
              onChange={(e) => (setChecked(e.target.checked), setError(null))}
            />
            <span className="leading-snug">
              {words.checkbox.split("{number}")[0]}
              <b className="whitespace-nowrap">{prettyPhone(phone)}</b>
              {words.checkbox.split("{number}")[1]}
            </span>
          </label>
          <p className="pl-10 text-[0.9rem] leading-snug text-ink">
            {words.disclosure}{" "}
            <Link href="/terms#park-texts" className="underline">
              Terms
            </Link>{" "}
            ·{" "}
            <Link href="/privacy#park-texts" className="underline">
              Privacy
            </Link>
          </p>
        </div>
      ) : null}
      <div aria-live="polite">
        {error ? <ErrorLine>{error}</ErrorLine> : null}
      </div>
      {open.email || open.text ? (
        <button
          type="button"
          disabled={pending}
          onClick={submit}
          className="crayon-btn wax mt-1 w-full bg-crayon-yellow py-3 text-3xl"
        >
          {pending ? PARK_NEWS.pending : PARK_NEWS.button}
        </button>
      ) : null}
      <button
        type="button"
        onClick={notNow}
        className="min-h-11 text-lg text-ink-soft underline underline-offset-2"
      >
        Not now
      </button>
    </div>
  );
}
