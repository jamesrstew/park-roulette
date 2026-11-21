"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { ErrorLine } from "@/components/ErrorLine";
import { Icon } from "@/components/icons";
import { TextsConsentBlock } from "@/components/ParkTexts";
import { ASKS_KEY, parseState, recordOn, recordPicksIgnored } from "@/lib/asks";
import { savePicks } from "@/lib/client-actions";
import { EVENTS } from "@/lib/events";
import { trackEvent } from "@/lib/events-client";
import {
  cleanEmail,
  EMAIL_CONSENT_TEXT,
  issueDay,
  successLine,
  suggestEmail,
} from "@/lib/park-news";
import { sfx } from "@/lib/sound";
import { storage } from "@/lib/storage";
import {
  type Agreement,
  checkboxLine,
  consentVersionFor,
  prettyPhone,
  TEXTS_CONSENT_TEXT,
  TEXTS_COPY,
  TEXTS_FROM,
} from "@/lib/texts";
import type { PicksFacts } from "@/lib/texts-actions";
import { dropWelcome } from "@/lib/welcome-url";

const SHEET_VERSION = consentVersionFor("welcome_sheet");
const EMAIL_WORDS = EMAIL_CONSENT_TEXT["email-2026-11-22-prechecked"];

/** The "Signup picks" event's values (n/a: the email card never showed). */
export type EmailAnswer =
  "yes" | "blank" | "unchecked" | "already" | "failed" | "closed" | "n/a";
export type TextsAnswer =
  "yes" | "no" | "hidden" | "already" | "failed" | "needs_start";

/** The texts done line: the hello text goes now only with confirmations on. */
export function textsDoneLine(confirmationsOn: boolean): string {
  return confirmationsOn
    ? TEXTS_COPY.hello
    : "You're in! Your first text comes when the Weekend Pick starts.";
}

/** What the sheet hands back when it's done. */
export type PicksOutcome = {
  /** A toast for the page (null: nothing to say). */
  toast: string | null;
  /** They said yes to texts: the install sheet waits a beat. */
  textsYes: boolean;
};

/**
 * The welcome sheet's last page, "picks": the Thursday email pre-checked
 * with its field (CAN-SPAM allows an opt-out email), and the Weekend Pick
 * as an unchecked box with the full disclosure (TCPA, CTIA: never
 * pre-checked; the filed CQXRMSG flow). One action saves both. A grown-up
 * who already gets both never sees this page (lib/texts-actions loadPicks).
 */
export function SignupPicks({
  facts,
  headingId,
  onFinish,
}: {
  facts: PicksFacts;
  headingId: string;
  onFinish: (o: PicksOutcome) => void;
}) {
  const id = useId();
  const emailRef = useRef<HTMLInputElement>(null);
  // The email card: hidden when the account gets it; behind "Add mine"
  // when only this browser's cookie says someone here does.
  const [addMine, setAddMine] = useState(false);
  const emailCard = !facts.emailOn && (!facts.emailOnHere || addMine);
  const [emailChecked, setEmailChecked] = useState(true);
  const [email, setEmail] = useState("");
  const [trap, setTrap] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailDone, setEmailDone] = useState<{ first: string | null } | null>(
    null,
  );

  const textsCard = facts.textsOffer && !!facts.phone;
  const [textsChecked, setTextsChecked] = useState(false);
  const [textsError, setTextsError] = useState<string | null>(null);
  const [textsDone, setTextsDone] = useState(false);
  const [needsStart, setNeedsStart] = useState(false);
  const [pending, start] = useTransition();

  const valid = cleanEmail(email);
  const firstIssue = facts.nextIssue ? issueDay(facts.nextIssue) : null;

  /**
   * "Signup picks": sent with the answers from each try (from the action's
   * results, never stale state), so a retry that works reports too; the
   * same values twice are sent once.
   */
  const lastReport = useRef("");
  const report = (e: EmailAnswer, t: TextsAnswer) => {
    const key = `${e}|${t}`;
    if (lastReport.current === key) return;
    lastReport.current = key;
    trackEvent(EVENTS.signupPicks, { email: e, texts: t });
  };
  /** The email answer when no yes was sent this time. */
  const emailBase = (): EmailAnswer =>
    facts.emailOn
      ? "already"
      : !emailCard
        ? "n/a"
        : emailDone
          ? "yes"
          : !emailChecked
            ? "unchecked"
            : "blank";
  /** The texts answer when no yes was sent this time. */
  const textsBase = (): TextsAnswer =>
    facts.textsOn
      ? "already"
      : !textsCard
        ? "hidden"
        : textsDone
          ? "yes"
          : needsStart
            ? "needs_start"
            : "no";

  /** An email box left unchecked or empty: one ignored next_pick. */
  const noteIgnored = (e: EmailAnswer) => {
    if (e !== "unchecked" && e !== "blank") return;
    storage.set(
      ASKS_KEY,
      JSON.stringify(
        recordPicksIgnored(parseState(storage.get(ASKS_KEY)), new Date()),
      ),
    );
  };

  const close = (e: EmailAnswer, t: TextsAnswer, first: string | null) => {
    const emailYes = e === "yes";
    const textsYes = t === "yes";
    const toast =
      emailYes && textsYes
        ? facts.confirmationsOn
          ? `You're in! Watch for a hello text, and your first email ${first ?? "Thursday morning"}.`
          : `You're in! Your first email comes ${first ?? "Thursday morning"}, and texts when the Weekend Pick starts.`
        : textsYes
          ? textsDoneLine(facts.confirmationsOn)
          : emailYes
            ? successLine(first)
            : null;
    noteIgnored(e);
    report(e, t);
    onFinish({ toast, textsYes });
  };

  const go = () => {
    setEmailError(null);
    setTextsError(null);
    const wantEmail =
      emailCard && emailChecked && !emailDone && email.trim() !== "";
    const wantTexts = textsCard && textsChecked && !textsDone && !needsStart;
    if (wantEmail && !valid) {
      setEmailError("That email looks off. Try again?");
      emailRef.current?.focus();
      return;
    }
    if (!wantEmail && !wantTexts)
      return close(emailBase(), textsBase(), emailDone?.first ?? firstIssue);
    const agreement: Agreement | null = wantTexts
      ? {
          agreed: true,
          version: SHEET_VERSION,
          checkbox: checkboxLine(SHEET_VERSION, facts.phone),
          disclosure: TEXTS_CONSENT_TEXT[SHEET_VERSION].disclosure,
        }
      : null;
    start(async () => {
      const r = await savePicks({
        email: wantEmail ? email : null,
        website: trap,
        texts: agreement,
        path: window.location.pathname,
      });
      dropWelcome();
      if (!r.ok) {
        sfx.oops();
        if (wantEmail) setEmailError(r.error);
        if (wantTexts) setTextsError(r.error);
        report(
          wantEmail ? "failed" : emailBase(),
          wantTexts ? "failed" : textsBase(),
        );
        return;
      }
      for (const t of r.tracks) trackEvent(t.name, t.props);
      let eDone = emailDone;
      let eAns: EmailAnswer = emailBase();
      let tAns: TextsAnswer = textsBase();
      let failed = false;
      let mustStart = false;
      if (wantEmail && r.email) {
        if (r.email.ok) {
          eDone = { first: r.email.firstIssue ?? firstIssue };
          eAns = "yes";
          setEmailDone(eDone);
          storage.set(
            ASKS_KEY,
            JSON.stringify(
              recordOn(parseState(storage.get(ASKS_KEY)), "email"),
            ),
          );
        } else {
          failed = true;
          eAns = "failed";
          setEmailError(r.email.error);
        }
      }
      if (wantTexts && r.texts) {
        const t = r.texts;
        if (t.ok && (t.state === "on" || t.state === "already")) {
          tAns = "yes";
          setTextsDone(true);
          storage.set(
            ASKS_KEY,
            JSON.stringify(recordOn(parseState(storage.get(ASKS_KEY)), "text")),
          );
        } else if (t.ok && t.state === "needs_start") {
          mustStart = true;
          tAns = "needs_start";
          setNeedsStart(true);
        } else {
          failed = true;
          tAns = "failed";
          setTextsError(
            t.ok ? `We couldn't text ${prettyPhone(facts.phone!)}.` : t.error,
          );
        }
      }
      if (failed || mustStart) {
        // The sheet stays open (try again, or Text START): report this try.
        sfx.oops();
        report(eAns, tAns);
        return;
      }
      sfx.pop();
      close(eAns, tAns, eDone?.first ?? firstIssue);
    });
  };

  const notNow = () => {
    // Not now and Escape record nothing on the account: just the event.
    report(emailDone ? "yes" : "closed", textsBase());
    onFinish({
      toast: emailDone ? successLine(emailDone.first) : null,
      textsYes: textsDone,
    });
  };
  const notNowRef = useRef(notNow);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    notNowRef.current = notNow;
  });
  useEffect(() => {
    // The page changed under the reader: start them at its heading.
    headingRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) =>
      e.key === "Escape" && notNowRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  /** The texts box is on the page: the button sits under its disclosure. */
  const textsForm = textsCard && !facts.textsOn && !textsDone && !needsStart;

  const retryLine = "Tap Let's spin! to try again, or uncheck it to skip.";
  const okLine = (text: string) => (
    <p className="flex items-center gap-2 leading-snug">
      <Icon name="check" size={26} className="shrink-0 text-crayon-green" />
      <span>{text}</span>
    </p>
  );

  return (
    <div className="flex flex-col gap-3">
      <h2
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
        className="font-hand text-4xl leading-[1.05] outline-none [@media(max-height:700px)]:text-[1.75rem] [@media(max-height:700px)]:whitespace-nowrap"
      >
        Where to this <span className="text-crayon-green">weekend?</span>
      </h2>
      <p className="-mt-1 leading-snug">
        We&apos;ll tell you, free, every week.
        {facts.proof ? (
          <span className="text-ink-soft [@media(max-height:700px)]:hidden">
            {" "}
            {facts.proof}+ grown-ups already get it.
          </span>
        ) : null}
      </p>

      {facts.emailOn ? (
        <div className="border-t-2 border-dashed border-ink/20 pt-3">
          {okLine("You already get the Thursday email.")}
        </div>
      ) : !emailCard ? (
        <div className="border-t-2 border-dashed border-ink/20 pt-3">
          <p className="flex items-center gap-2 leading-snug">
            <Icon
              name="check"
              size={26}
              className="shrink-0 text-crayon-green"
            />
            <span>
              Someone on this phone already gets the Thursday email.{" "}
              <button
                type="button"
                onClick={() => {
                  setAddMine(true);
                  requestAnimationFrame(() => emailRef.current?.focus());
                }}
                className="inline-flex min-h-11 items-center font-bold underline underline-offset-2"
              >
                Add mine
              </button>
            </span>
          </p>
        </div>
      ) : emailDone ? (
        <section className="doodle-box-alt bg-[color-mix(in_srgb,var(--color-crayon-blue)_8%,#fffdf7)] px-4 py-3">
          {okLine(successLine(emailDone.first))}
        </section>
      ) : (
        <section
          aria-labelledby={`${id}-et`}
          className="doodle-box-alt flex flex-col gap-2 bg-[color-mix(in_srgb,var(--color-crayon-blue)_8%,#fffdf7)] px-4 py-3"
        >
          <label className="flex min-h-11 cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 size-7 shrink-0 accent-crayon-blue"
              checked={emailChecked}
              onChange={(e) => (
                setEmailChecked(e.target.checked),
                setEmailError(null)
              )}
              aria-describedby={`${id}-eb`}
            />
            <span className="flex flex-col">
              <span
                id={`${id}-et`}
                className="font-hand text-2xl leading-tight"
              >
                {EMAIL_WORDS.title}
              </span>
              <span id={`${id}-eb`} className="leading-snug">
                {EMAIL_WORDS.body}
              </span>
            </span>
          </label>
          {emailChecked ? (
            <div className="flex flex-col gap-1.5 pl-10">
              <label htmlFor={`${id}-email`} className="sr-only">
                Your email
              </label>
              <input
                ref={emailRef}
                id={`${id}-email`}
                className="field min-w-0 text-base"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="off"
                spellCheck={false}
                enterKeyHint="done"
                maxLength={254}
                placeholder="you@example.com"
                aria-invalid={emailError ? true : undefined}
                aria-describedby={`${id}-fine`}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setHint(null);
                  setEmailError(null);
                }}
                onBlur={() => setHint(suggestEmail(email))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.currentTarget.blur();
                  }
                }}
              />
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
              {emailError ? (
                <>
                  <ErrorLine>{emailError}</ErrorLine>
                  {textsDone ? (
                    <p className="text-sm text-ink-soft">{retryLine}</p>
                  ) : null}
                </>
              ) : null}
              <p
                id={`${id}-fine`}
                className="text-sm leading-snug text-ink-soft"
              >
                {firstIssue
                  ? EMAIL_WORDS.fine.replace("{date}", firstIssue)
                  : EMAIL_WORDS.fineNoDate}{" "}
                <Link
                  href="/privacy#park-news"
                  className="underline"
                  target="_blank"
                  rel="noopener"
                >
                  Privacy
                </Link>
              </p>
            </div>
          ) : null}
          {/* The honeypot: hidden from people and screen readers. */}
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
        </section>
      )}

      {facts.textsOn && facts.phone ? (
        okLine(
          `${prettyPhone(facts.phone)} already gets the ${TEXTS_COPY.title}.`,
        )
      ) : !textsCard ? null : needsStart ? (
        <section
          role="status"
          className="doodle-box-alt flex flex-col gap-2 bg-[color-mix(in_srgb,var(--color-crayon-green)_9%,#fffdf7)] px-4 py-3"
        >
          <h3 className="font-hand text-2xl leading-tight">One more step</h3>
          <p className="leading-snug">
            You texted STOP to us before, so the yes has to come from your
            phone. Text START to{" "}
            <b className="whitespace-nowrap">
              {TEXTS_FROM ? prettyPhone(TEXTS_FROM) : "the park texts number"}
            </b>
            .
          </p>
          {TEXTS_FROM ? (
            <a
              href={`sms:${TEXTS_FROM}?&body=START`}
              className="crayon-btn wax min-h-12 bg-crayon-green px-5 text-xl text-white [text-shadow:1px_1px_0_#2b2a33]"
            >
              Text START
            </a>
          ) : null}
        </section>
      ) : textsDone ? (
        <section className="doodle-box-alt bg-[color-mix(in_srgb,var(--color-crayon-green)_9%,#fffdf7)] px-4 py-3">
          {okLine(textsDoneLine(facts.confirmationsOn))}
        </section>
      ) : (
        <section
          aria-labelledby={`${id}-tt`}
          className={`doodle-box-alt flex flex-col gap-2 px-4 py-3 transition-colors ${
            textsChecked
              ? "bg-[color-mix(in_srgb,var(--color-crayon-green)_16%,#fffdf7)]"
              : "bg-[color-mix(in_srgb,var(--color-crayon-green)_9%,#fffdf7)]"
          }`}
        >
          <h3
            id={`${id}-tt`}
            className="flex items-center gap-2 font-hand text-2xl leading-tight"
          >
            <Icon name="phone" size={28} className="text-crayon-green" />{" "}
            {TEXTS_COPY.title}
          </h3>
          <p className="-mt-1 leading-snug">{TEXTS_COPY.subtitle}</p>
          <TextsConsentBlock
            id={`${id}-t`}
            version={SHEET_VERSION}
            number={facts.phone}
            checked={textsChecked}
            onChange={(v) => (setTextsChecked(v), setTextsError(null))}
            newTab
          />
          {textsError ? (
            <div className="pl-10">
              <ErrorLine>{textsError}</ErrorLine>
              {emailDone ? (
                <p className="mt-1 text-sm text-ink-soft">{retryLine}</p>
              ) : null}
            </div>
          ) : null}
        </section>
      )}

      {/* Sticky, except while the texts box shows: then the button sits in
          the flow right under the whole disclosure, so it's never covered. */}
      <div
        className={`-mx-5 -mb-5 flex flex-col gap-1 bg-[#fffdf7] px-5 pt-2 pb-[max(env(safe-area-inset-bottom),0.75rem)] ${textsForm ? "" : "sticky bottom-0"}`}
      >
        {emailCard && emailChecked && !emailDone && valid ? (
          <p className="text-center text-[0.95rem] leading-snug">
            We&apos;ll email <b className="break-all">{valid}</b> on Thursdays.
          </p>
        ) : null}
        <button
          type="button"
          disabled={pending}
          onClick={go}
          className="crayon-btn wax w-full bg-crayon-yellow py-3 text-3xl"
        >
          {pending ? (
            "One sec…"
          ) : (
            <>
              {TEXTS_CONSENT_TEXT[SHEET_VERSION].button}{" "}
              <Icon name="spin" size={30} />
            </>
          )}
        </button>
        <button
          type="button"
          onClick={notNow}
          className="mx-auto min-h-11 px-3 text-ink-soft underline underline-offset-2"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
