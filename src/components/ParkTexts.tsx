"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { ErrorLine } from "@/components/ErrorLine";
import { Icon } from "@/components/icons";
import {
  confirmTextsCode,
  sendTextsCode,
  stopTexts,
  turnOnTexts,
} from "@/lib/client-actions";
import { codeDigits, typePhone } from "@/lib/phone-format";
import { sfx } from "@/lib/sound";
import {
  type Agreement,
  checkboxLine,
  consentVersionFor,
  prettyPhone,
  SAMPLE_TEXT,
  TEXTS_CONSENT_TEXT,
  TEXTS_CONSENT_VERSION,
  TEXTS_COPY,
  type TextSource,
} from "@/lib/texts";

type Source = TextSource;
type Done = "on" | "already" | "needs_start" | "failed";

/**
 * The Weekend Pick yes, one component everywhere. Order: headline, body,
 * the unchecked box, the disclosure (in ink, right under the box, above the
 * button), the button. Signed out (or a number without a recent code) it
 * texts a code first. The reply is the same whether or not the number
 * already gets texts.
 */
export function ParkTextsCard({
  number,
  source,
  sendingOn,
  textsFrom,
  bare = false,
  labelledBy,
  showSample = false,
  headline = TEXTS_COPY.headline,
  doneLine,
  onDone,
}: {
  /** The signed-in grown-up's number (E.164); null to type one in. */
  number: string | null;
  source: Source;
  /** Texts are really going out (else the success line says when). */
  sendingOn: boolean;
  /** The park texts number, for "Text START" (null before registration). */
  textsFrom: string | null;
  /** No card frame or headline (inside settings or onboarding). */
  bare?: boolean;
  /**
   * The page's own heading names the card (/texts): no card headline, and
   * the section is labelled by that heading's id.
   */
  labelledBy?: string;
  /** After a yes, show what a Weekend Pick looks like (/texts). */
  showSample?: boolean;
  /** The card's heading (the site footer: "Rather get a text?"). */
  headline?: string;
  /** The line after a yes, instead of the default. */
  doneLine?: string;
  onDone?: (state: Done) => void;
}) {
  const id = useId();
  // Each surface shows (and the server accepts) only its own wording.
  const version = consentVersionFor(source);
  const words = TEXTS_CONSENT_TEXT[version];
  const [typed, setTyped] = useState("");
  const [checked, setChecked] = useState(false);
  const [step, setStep] = useState<"ask" | "code">("ask");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [pending, start] = useTransition();
  const path = typeof window === "undefined" ? "" : window.location.pathname;
  const phone = number ?? typed;
  // What the person sees and agrees to, sent with the yes and recorded.
  const agreement = (): Agreement => ({
    agreed: true,
    version,
    checkbox: checkboxLine(version, number ?? null),
    disclosure: words.disclosure,
  });
  const finish = (s: Done) => {
    setDone(s);
    if (s === "on" || s === "already") sfx.pop();
    onDone?.(s);
  };
  const ask = () =>
    start(async () => {
      setError(null);
      if (!checked) return setError(TEXTS_COPY.unchecked);
      if (number) {
        const r = await turnOnTexts(source, path, agreement());
        if (r.ok) return finish(r.state);
        if (!("reason" in r) || r.reason !== "code") return setError(r.error);
      }
      const s = await sendTextsCode(phone);
      if (!s.ok) return setError(s.error);
      setStep("code");
    });
  const check = () =>
    start(async () => {
      setError(null);
      const r = await confirmTextsCode(phone, code, source, path, agreement());
      if (!r.ok) return setError(r.error);
      finish(r.state);
    });

  const frame = bare
    ? "flex flex-col gap-2"
    : "doodle-box-alt flex flex-col gap-2 bg-[color-mix(in_srgb,var(--color-crayon-green)_9%,#fffdf7)] px-4 py-4";

  if (done === "on" || done === "already")
    return (
      <div role="status" className="flex flex-col gap-2">
        <p className="flex animate-pop-in items-center gap-2 font-hand text-xl leading-snug">
          <Icon name="check" size={28} />
          {doneLine ??
            (sendingOn
              ? "You're in! Watch for a text."
              : "You're in! Your first text comes when the Weekend Pick starts.")}
        </p>
        {showSample ? (
          <>
            <p className="text-sm text-ink-soft">{TEXTS_COPY.firstLooksLike}</p>
            <p className="rounded-3xl border-2 border-ink bg-[#fffdf7] px-5 py-4 leading-snug break-words">
              {SAMPLE_TEXT}
            </p>
          </>
        ) : null}
      </div>
    );
  if (done === "needs_start")
    return (
      <div role="status" className={frame}>
        <h3 className="font-hand text-2xl leading-tight">One more step</h3>
        <p className="leading-snug">
          You texted STOP to us before, so the yes has to come from your phone.{" "}
          {textsFrom ? (
            <>
              Text START to{" "}
              <b className="whitespace-nowrap">{prettyPhone(textsFrom)}</b>.
            </>
          ) : (
            "Text START to the park texts number once texts begin."
          )}
        </p>
        {textsFrom ? (
          <a
            href={`sms:${textsFrom}?&body=START`}
            className="crayon-btn wax min-h-12 bg-crayon-green px-5 text-xl text-white [text-shadow:1px_1px_0_#2b2a33]"
          >
            Text START
          </a>
        ) : null}
      </div>
    );
  if (done === "failed")
    return (
      <div role="status" className={frame}>
        <ErrorLine>{`We couldn't text ${prettyPhone(phone.startsWith("+") ? phone : `+1${phone.replace(/\D/g, "")}`)}. Try again?`}</ErrorLine>
        <button
          type="button"
          onClick={() => setDone(null)}
          className="chip min-h-11 self-start"
        >
          Try again
        </button>
      </div>
    );

  return (
    <section
      aria-labelledby={labelledBy ?? (bare ? undefined : `${id}-h`)}
      className={frame}
    >
      {bare || labelledBy ? null : (
        <>
          <h2
            id={`${id}-h`}
            className="flex items-center gap-2 font-hand text-3xl leading-tight"
          >
            <Icon name="phone" size={32} className="text-crayon-green" />{" "}
            {headline}
          </h2>
          {headline === TEXTS_COPY.headline ? (
            <p className="-mt-1 leading-snug">{TEXTS_COPY.body}</p>
          ) : null}
        </>
      )}
      {step === "ask" ? (
        <>
          {number ? null : (
            <>
              <label htmlFor={`${id}-num`} className="font-hand text-xl">
                Your mobile number
              </label>
              <input
                id={`${id}-num`}
                className="field text-base"
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                placeholder="(541) 555-0123"
                value={typed}
                onChange={(e) => (
                  setTyped(typePhone(e.target.value)),
                  setError(null)
                )}
              />
            </>
          )}
          <TextsConsentBlock
            id={id}
            version={version}
            number={number}
            checked={checked}
            onChange={(v) => (setChecked(v), setError(null))}
          />
          <div aria-live="polite">
            {error ? <ErrorLine>{error}</ErrorLine> : null}
          </div>
          <button
            type="button"
            disabled={pending}
            onClick={ask}
            className="crayon-btn wax min-h-12 bg-crayon-green px-5 text-xl text-white [text-shadow:1px_1px_0_#2b2a33]"
          >
            {pending ? "One sec…" : words.button}
          </button>
          {number ? null : (
            <p className="text-center text-sm text-ink-soft">
              {TEXTS_COPY.codeFirst}
            </p>
          )}
        </>
      ) : (
        <>
          <label htmlFor={`${id}-code`} className="leading-snug">
            We texted a code to{" "}
            <b className="whitespace-nowrap">{typePhone(phone)}</b>. Type it
            here:
          </label>
          <input
            id={`${id}-code`}
            className="field text-center font-hand text-3xl tracking-[0.3em]"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => (
              setCode(codeDigits(e.target.value)),
              setError(null)
            )}
          />
          <div aria-live="polite">
            {error ? <ErrorLine>{error}</ErrorLine> : null}
          </div>
          <button
            type="button"
            disabled={pending || code.length !== 6}
            onClick={check}
            className="crayon-btn wax min-h-12 bg-crayon-green px-5 text-xl text-white [text-shadow:1px_1px_0_#2b2a33]"
          >
            {pending ? "One sec…" : words.button}
          </button>
          <button
            type="button"
            onClick={() => (setStep("ask"), setCode(""))}
            className="min-h-11 text-sm text-ink-soft underline underline-offset-2"
          >
            Send a new code
          </button>
        </>
      )}
    </section>
  );
}

/** Family & settings: the Weekend Pick row in the Park picks card. */
export function TextsRow({
  state,
  number,
  sendingOn,
  textsFrom,
}: {
  state: "on" | "off" | "no_number" | "changed" | "borrowed";
  number: string | null;
  sendingOn: boolean;
  textsFrom: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(state);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const stop = () =>
    start(async () => {
      const r = await stopTexts();
      if (!r.ok) return;
      setNow("off");
      setSaved("Texts off.");
    });
  return (
    <div className="flex flex-col gap-2 border-t border-dashed border-ink/25 pt-3">
      <h3 className="flex items-center gap-2 font-hand text-xl leading-tight">
        <Icon name="phone" size={24} className="text-crayon-green" /> Weekend
        Pick{" "}
        <span className="font-body text-sm text-ink-soft">
          · Friday afternoons
        </span>
      </h3>
      {now === "on" ? (
        <>
          <p className="leading-snug">
            On, Fridays, to{" "}
            <b className="whitespace-nowrap">
              {number ? prettyPhone(number) : ""}
            </b>
            .
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={stop}
            className="min-h-11 self-start text-sm text-ink-soft underline underline-offset-2"
          >
            Stop texts
          </button>
        </>
      ) : now === "no_number" ? (
        <>
          <p className="leading-snug">{TEXTS_COPY.noNumber}</p>
          <a href="#phone" className="chip min-h-11 self-start">
            Add my number
          </a>
        </>
      ) : now === "borrowed" ? (
        <p className="leading-snug">{TEXTS_COPY.borrowed}</p>
      ) : open ? (
        <>
          <ParkTextsCard
            number={number}
            source="settings"
            sendingOn={sendingOn}
            textsFrom={textsFrom}
            bare
            onDone={(s) => {
              if (s === "on" || s === "already") setNow("on");
            }}
          />
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="min-h-11 self-start text-sm text-ink-soft underline underline-offset-2"
          >
            Never mind
          </button>
        </>
      ) : (
        <>
          <p className="leading-snug">
            {now === "changed" ? TEXTS_COPY.changed : TEXTS_COPY.off}
          </p>
          <button
            type="button"
            onClick={() => (setOpen(true), setSaved(null))}
            className="chip min-h-11 self-start"
          >
            Get the Weekend Pick
          </button>
        </>
      )}
      {saved ? (
        <p role="status" className="flex items-center gap-2 font-hand text-xl">
          <Icon name="check" size={24} /> {saved}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The consent block, one source for every Weekend Pick yes (/texts,
 * settings, the ask sheet): the unchecked box with the checkbox line, and
 * the full disclosure in ink right under it, with Terms and Privacy. The
 * words come from the frozen TEXTS_CONSENT_TEXT[version] (each surface has
 * its own, lib/texts.ts consentVersionFor); never retype them.
 */
export function TextsConsentBlock({
  id,
  version = TEXTS_CONSENT_VERSION,
  number,
  checked,
  onChange,
  newTab = false,
}: {
  /** A unique id prefix (useId) for the disclosure's id. */
  id: string;
  /** Terms and Privacy open in a new tab (inside a sheet, so a tap never loses it). */
  newTab?: boolean;
  /** The surface's consent version (consentVersionFor(source)). */
  version?: string;
  /** The signed-in number (E.164), or null for "this number". */
  number: string | null;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const words = TEXTS_CONSENT_TEXT[version];
  return (
    <>
      <label className="flex min-h-11 cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 size-7 shrink-0 accent-crayon-green"
          checked={checked}
          aria-describedby={`${id}-terms`}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="leading-snug">
          {number ? (
            <>
              {words.checkbox.split("{number}")[0]}
              <b className="whitespace-nowrap">{prettyPhone(number)}</b>
              {words.checkbox.split("{number}")[1]}
            </>
          ) : (
            checkboxLine(version, null)
          )}
        </span>
      </label>
      <p
        id={`${id}-terms`}
        className="pl-10 text-[0.9rem] leading-snug text-ink sm:-mt-2"
      >
        {words.disclosure}{" "}
        <span className="whitespace-nowrap">
          <Link
            href="/terms#park-texts"
            className="underline"
            {...(newTab ? { target: "_blank", rel: "noopener" } : {})}
          >
            Terms
          </Link>{" "}
          ·{" "}
          <Link
            href="/privacy#park-texts"
            className="underline"
            {...(newTab ? { target: "_blank", rel: "noopener" } : {})}
          >
            Privacy
          </Link>
        </span>
      </p>
    </>
  );
}
