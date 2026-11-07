"use client";

import { useEffect, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Icon } from "@/components/icons";
import { ErrorLine } from "@/components/ErrorLine";
import { PasteInvite } from "@/components/me/PasteInvite";
import {
  checkAddPhoneCode,
  checkSignInCode,
  finishClaim,
  movePhoneHere,
  sendAddPhoneCode,
  sendSignInCode,
  startClaim,
  type PhoneResult,
} from "@/lib/client-actions";
import { codeDigits, normalizeUSPhone, typePhone } from "@/lib/phone-format";
import { sfx } from "@/lib/sound";
import { sayHello } from "./HelloToast";

/**
 * The one phone-number-and-code widget, used everywhere someone signs in or
 * adds their number, so the steps and words never drift apart.
 *
 *  signin: number → code → in (or "we don't know that number yet")
 *  add:    number → code → it's yours (or "that's Mom's number!")
 *  claim:  code only, texted to a family member's number we never show in full
 *
 * iPhone details that make or break it: one input with
 * autocomplete="one-time-code" (the code appears above the keyboard), the
 * code field is focused inside the same tap that sends (or iOS won't raise
 * the keyboard), and the step survives the app reloading while you check
 * Messages.
 */

type Mode = "signin" | "add" | "claim";
type Step = "phone" | "code" | "unknown" | "crewmate" | "conflict" | "done";

const RESEND_S = 30;
const SAVE_KEY = "pr:phone-step";
const SAVE_TTL_MS = 10 * 60 * 1000; // Twilio codes last 10 minutes
/** "You're in!" stays up this long before we move on. */
const CHEER_MS = 650;

type Saved = { mode: Mode; phone: string; shown: string; sentAt: number };

function loadSaved(mode: Mode): Saved | null {
  try {
    const s = JSON.parse(sessionStorage.getItem(SAVE_KEY) ?? "null") as Saved;
    if (s?.mode === mode && Date.now() - s.sentAt < SAVE_TTL_MS) return s;
  } catch {}
  return null;
}
function save(s: Saved | null) {
  try {
    if (s) sessionStorage.setItem(SAVE_KEY, JSON.stringify(s));
    else sessionStorage.removeItem(SAVE_KEY);
  } catch {}
}

const linkBtn =
  "min-h-11 px-1 font-hand text-lg text-ink-soft underline underline-offset-4 disabled:no-underline disabled:opacity-60";

export function PhoneCode({
  mode,
  claim,
  next,
  onDone,
  onSkip,
  skipLabel = "Skip for now",
  onCancel,
  submitLabel = "Text me a code",
  codeLabel,
  hello = (name) => `Welcome back, ${name}!`,
  autoFocus,
}: {
  mode: Mode;
  /**
   * claim: who we're switching to. The sheet opens (and focuses the code
   * field) inside the tap; this component then asks the server to text them.
   */
  claim?: { explorerId: number; joinCode?: string; name: string };
  /** signin/claim: where to go after (defaults to Spin). */
  next?: string;
  /** add: called once the number is saved. */
  onDone?: (shown: string) => void;
  onSkip?: () => void;
  skipLabel?: string;
  /** claim: "never mind". */
  onCancel?: () => void;
  submitLabel?: string;
  /** The button under the code ("Let me in!", "Switch to Theo"). */
  codeLabel?: string;
  /** The note on the next screen after signing in. */
  hello?: (name: string) => string;
  autoFocus?: boolean;
}) {
  const uid = useId();
  const [step, setStep] = useState<Step>(claim ? "code" : "phone");
  const [phone, setPhone] = useState("");
  const [shown, setShown] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** The code can't be used any more: expired, too many tries, or locked. */
  const [stale, setStale] = useState<null | "fresh" | "locked">(null);
  const [busy, setBusy] = useState<null | "sending" | "checking">(
    claim ? "sending" : null,
  );
  const [cheer, setCheer] = useState(false);
  const [sentAt, setSentAt] = useState(() => (claim ? Date.now() : 0));
  const [now, setNow] = useState(() => Date.now());
  const [who, setWho] = useState<{
    id: number;
    name: string;
    crewName: string;
  } | null>(null);
  const [shake, setShake] = useState(false);
  const phoneRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const headRef = useRef<HTMLParagraphElement>(null);
  const inFlight = useRef(false);

  // Came back from Messages and the app reloaded? Pick up on the code step.
  useEffect(() => {
    if (claim) return;
    const s = loadSaved(mode);
    if (!s) return;
    /* eslint-disable react-hooks/set-state-in-effect -- restore once on mount */
    setPhone(typePhone(s.phone));
    setShown(s.shown);
    setSentAt(s.sentAt);
    setStep("code");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [mode, claim]);

  // claim: text them as soon as the sheet is open (it opened in the tap).
  const claimId = claim?.explorerId;
  const claimCode = claim?.joinCode;
  useEffect(() => {
    if (claimId == null) return;
    let live = true;
    startClaim(claimId, claimCode).then((r: PhoneResult) => {
      if (!live) return;
      setBusy(null);
      setSentAt(Date.now());
      if (!r.ok) {
        setError(r.error);
        return;
      }
      if (r.done) return cheerThenGo(r.name ?? "");
      setShown(r.shown ?? "");
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per claim
  }, [claimId, claimCode]);

  useEffect(() => {
    if (step !== "code") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [step]);

  useEffect(() => {
    if (!autoFocus) return;
    if (step === "phone") phoneRef.current?.focus();
    else if (step === "code" && claim) codeRef.current?.focus();
  }, [autoFocus, step, claim]);

  // A new state (unknown number, "that's Mom's number"…): say so, move focus.
  useEffect(() => {
    if (step === "unknown" || step === "crewmate" || step === "conflict")
      headRef.current?.focus();
  }, [step]);

  const wait = Math.min(
    RESEND_S,
    Math.max(0, RESEND_S - Math.floor((now - sentAt) / 1000)),
  );

  function cheerThenGo(name: string, dest = next) {
    save(null);
    setCheer(true);
    sfx.yay();
    sayHello(hello(name));
    setTimeout(() => {
      // A full load, so every screen picks up who is signed in now.
      window.location.assign(dest ?? "/");
    }, CHEER_MS);
  }

  /** Text a code. Called straight from the tap, so focus can move to the code. */
  function send(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy) return;
    setError(null);
    const e164 = normalizeUSPhone(phone);
    if (!e164) {
      setError("Hmm, that doesn't look like a US cell number.");
      setShake(true);
      phoneRef.current?.focus();
      return;
    }
    // Show the code step and focus it inside this tap (iOS raises the keyboard
    // and offers the code from Messages only if focus moves during a tap).
    flushSync(() => {
      setStep("code");
      setCode("");
      setStale(null);
      setShown(typePhone(e164));
      setSentAt(Date.now());
    });
    codeRef.current?.focus();
    setBusy("sending");
    (mode === "add" ? sendAddPhoneCode : sendSignInCode)(e164).then(
      (r: PhoneResult) => {
        setBusy(null);
        if (r.ok) {
          setShown(r.shown ?? typePhone(e164));
          save({ mode, phone: e164, shown: r.shown ?? "", sentAt: Date.now() });
          return;
        }
        setError(r.error);
        setStep("phone");
        sfx.oops();
      },
    );
  }

  /** "Text me again" on the code step. */
  function resend() {
    if (busy) return;
    setError(null);
    setStale(null);
    setCode("");
    setSentAt(Date.now());
    codeRef.current?.focus();
    setBusy("sending");
    const go = claim
      ? startClaim(claim.explorerId, claim.joinCode)
      : (mode === "add" ? sendAddPhoneCode : sendSignInCode)(phone);
    go.then((r: PhoneResult) => {
      setBusy(null);
      if (!r.ok) {
        setError(r.error);
        sfx.oops();
      }
    });
  }

  async function check(digits: string) {
    if (inFlight.current || digits.length !== 6) return;
    inFlight.current = true;
    setBusy("checking");
    setError(null);
    let r: PhoneResult;
    if (claim) r = await finishClaim(claim.explorerId, digits, claim.joinCode);
    else if (mode === "add") r = await checkAddPhoneCode(phone, digits);
    else r = await checkSignInCode(phone, digits, next);
    setBusy(null);
    inFlight.current = false;

    if (r.ok) {
      if (mode === "add") {
        save(null);
        sfx.yay();
        setShown(r.shown ?? shown);
        setStep("done");
        onDone?.(r.shown ?? shown);
        return;
      }
      return cheerThenGo(r.name ?? "", r.next ?? next);
    }
    if (
      r.reason === "unknown" ||
      r.reason === "crewmate" ||
      r.reason === "conflict"
    ) {
      save(null);
      setWho(r.who ?? null);
      setStep(r.reason);
      return;
    }
    // Wrong, stale or locked: clear, wiggle, keep the keyboard up.
    setError(r.error);
    setStale(
      r.reason === "locked"
        ? "locked"
        : r.reason === "expired" || r.reason === "too_many"
          ? "fresh"
          : null,
    );
    setCode("");
    setShake(true);
    sfx.oops();
    codeRef.current?.focus();
  }

  function changeNumber() {
    save(null);
    setStep("phone");
    setCode("");
    setError(null);
    setStale(null);
    requestAnimationFrame(() => phoneRef.current?.focus());
  }

  async function moveHere() {
    setBusy("checking");
    const r = await movePhoneHere();
    setBusy(null);
    if (r.ok) {
      sfx.yay();
      setShown(r.shown ?? shown);
      setStep("done");
      onDone?.(r.shown ?? shown);
    } else {
      setError(r.error);
      setStep("phone");
    }
  }

  /** "I'm Mom": this phone just proved Mom's number, so switch to her. */
  async function switchToOwner() {
    if (!who) return;
    setBusy("checking");
    const r = await startClaim(who.id);
    setBusy(null);
    if (r.ok && r.done) return cheerThenGo(r.name ?? who.name);
    setError(r.ok ? "That took a while. Let's send a fresh code." : r.error);
    setStep("phone");
  }

  if (cheer)
    return (
      <p
        role="status"
        className="flex animate-pop-in items-center justify-center gap-2 py-6 font-hand text-3xl"
      >
        <Icon name="check" size={36} /> You&apos;re in!
      </p>
    );

  // ---------- the number ----------
  if (step === "phone")
    return (
      <form onSubmit={send} className="flex flex-col gap-2 text-left">
        <label htmlFor={`${uid}-phone`} className="font-hand text-xl">
          Your cell number
        </label>
        <input
          ref={phoneRef}
          id={`${uid}-phone`}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          enterKeyHint="send"
          placeholder="(541) 555-0123"
          className={`field font-hand text-3xl tracking-wide ${shake ? "animate-wiggle" : ""}`}
          onAnimationEnd={() => setShake(false)}
          value={phone}
          onChange={(e) => {
            setPhone(typePhone(e.target.value));
            setError(null);
          }}
        />
        {error ? <ErrorLine>{error}</ErrorLine> : null}
        {/* type=button + onClick: the code step replaces this form in the same
            tap, and a removed submit button makes the browser's submit throw */}
        <button
          type="button"
          onClick={() => send()}
          disabled={!!busy}
          className="crayon-btn wax mt-1 bg-crayon-green py-3 text-2xl text-white [text-shadow:1px_1px_0_#2b2a33]"
        >
          <Icon name="phone" size={28} /> {submitLabel}
        </button>
        <p className="text-center text-sm leading-snug text-ink-soft">
          We&apos;ll text you a 6-digit code.
        </p>
        {onSkip ? (
          <button
            type="button"
            onClick={onSkip}
            className="crayon-btn mt-1 bg-[#fffdf7] text-xl"
          >
            {skipLabel}
          </button>
        ) : null}
      </form>
    );

  // ---------- the code ----------
  if (step === "code")
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          check(code);
        }}
        className="flex flex-col gap-2"
      >
        <p
          id={`${uid}-sent`}
          className="flex flex-wrap items-center gap-x-2 leading-snug"
        >
          <span>
            {claim ? (
              shown ? (
                <>
                  We texted {claim.name}&apos;s phone,{" "}
                  <b className="whitespace-nowrap">{shown}</b>.
                </>
              ) : (
                <>Texting {claim.name}&apos;s phone…</>
              )
            ) : (
              <>
                We texted <b className="whitespace-nowrap">{shown}</b>.
              </>
            )}
          </span>
          {claim ? (
            onCancel ? (
              <button type="button" onClick={onCancel} className={linkBtn}>
                Not you?
              </button>
            ) : null
          ) : (
            <button type="button" onClick={changeNumber} className={linkBtn}>
              Change
            </button>
          )}
        </p>
        <label htmlFor={`${uid}-code`} className="sr-only">
          6-digit code
        </label>
        <input
          ref={codeRef}
          id={claim ? "code-claim" : `${uid}-code`}
          data-code-input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="one-time-code"
          enterKeyHint="go"
          placeholder="••••••"
          aria-describedby={`${uid}-sent ${uid}-status`}
          className={`field w-full text-center font-hand text-5xl tracking-[0.25em] placeholder:text-ink/25 ${shake ? "animate-wiggle" : ""}`}
          onAnimationEnd={() => setShake(false)}
          value={code}
          // readOnly, not disabled: disabling would drop focus (and the
          // keyboard) while we check, and a wrong code wants them right back
          readOnly={busy === "checking"}
          onChange={(e) => {
            const d = codeDigits(e.target.value);
            setCode(d);
            setError(null);
            if (d.length === 6) check(d);
          }}
        />
        <div id={`${uid}-status`} aria-live="polite" className="min-h-11">
          {error ? (
            <ErrorLine>{error}</ErrorLine>
          ) : busy ? (
            <p className="py-2 text-center font-hand text-xl text-ink-soft">
              {busy === "checking" ? "Checking…" : "Sending…"}
            </p>
          ) : stale ? null : (
            <p className="text-center">
              <button
                type="button"
                onClick={resend}
                disabled={wait > 0}
                className={linkBtn}
              >
                {wait > 0
                  ? `Text me again in 0:${String(wait).padStart(2, "0")}`
                  : "Didn't get it? Text me again"}
              </button>
            </p>
          )}
        </div>
        {stale === "locked" ? null : stale === "fresh" ? (
          <button
            type="button"
            onClick={resend}
            disabled={!!busy}
            className="crayon-btn wax bg-crayon-green text-xl text-white [text-shadow:1px_1px_0_#2b2a33]"
          >
            Text me a new code
          </button>
        ) : (
          <button
            type="submit"
            disabled={!!busy || code.length !== 6}
            className="crayon-btn wax bg-crayon-yellow py-3 text-2xl"
          >
            {codeLabel ?? (mode === "add" ? "Save my number" : "Let me in!")}
          </button>
        )}
      </form>
    );

  // ---------- proved a number nobody has ----------
  if (step === "unknown")
    return (
      <div className="flex flex-col gap-3 text-left">
        <p
          ref={headRef}
          tabIndex={-1}
          className="font-hand text-2xl leading-tight outline-none"
        >
          We don&apos;t know <span className="whitespace-nowrap">{shown}</span>{" "}
          yet!
        </p>
        <p className="leading-snug">
          <b>New here?</b> Paste the invite link someone sent you, and this
          number will sign you in from then on.
        </p>
        <p className="leading-snug">
          <b>Played before without a number?</b> Paste your family link and tap
          yourself.
        </p>
        <PasteInvite label="Paste your link:" />
        <p className="text-sm leading-snug text-ink-soft">
          No link? Ask someone who plays to send one from their Me page.
        </p>
        <button
          type="button"
          onClick={changeNumber}
          className={`${linkBtn} self-start`}
        >
          Try a different number
        </button>
      </div>
    );

  // ---------- add: proved a number that's a family member's ----------
  if (step === "crewmate")
    return (
      <div className="flex flex-col gap-3 text-center">
        <p
          ref={headRef}
          tabIndex={-1}
          className="font-hand text-2xl leading-tight outline-none"
        >
          That&apos;s {who?.name ?? "a family member"}&apos;s number!
        </p>
        <p className="leading-snug">
          One number per explorer. Kids and phone-sharers don&apos;t need one.
        </p>
        {error ? <ErrorLine>{error}</ErrorLine> : null}
        {onSkip ? (
          <button
            type="button"
            onClick={onSkip}
            className="crayon-btn wax bg-crayon-yellow text-xl"
          >
            {skipLabel}
          </button>
        ) : null}
        {who ? (
          <button
            type="button"
            onClick={switchToOwner}
            disabled={!!busy}
            className="crayon-btn bg-[#fffdf7] text-xl"
          >
            I&apos;m {who.name}: switch to me
          </button>
        ) : null}
        <button
          type="button"
          onClick={moveHere}
          disabled={!!busy}
          className="crayon-btn bg-[#fffdf7] text-xl"
        >
          It&apos;s mine now: move it here
        </button>
        <button type="button" onClick={changeNumber} className={linkBtn}>
          Use a different number
        </button>
      </div>
    );

  // ---------- add: proved a number that signs in someone in another family ----------
  if (step === "conflict")
    return (
      <div className="flex flex-col gap-3 text-center">
        <p
          ref={headRef}
          tabIndex={-1}
          className="font-hand text-2xl leading-tight outline-none"
        >
          That number signs in {who?.name ?? "someone"}
          {who?.crewName ? ` in ${who.crewName}` : ""}.
        </p>
        <p className="leading-snug">
          A number can only sign in one explorer. Move it here, and that
          explorer will need a different one.
        </p>
        {error ? <ErrorLine>{error}</ErrorLine> : null}
        <button
          type="button"
          onClick={() => (onSkip ? onSkip() : changeNumber())}
          className="crayon-btn wax bg-crayon-yellow text-xl"
        >
          Keep it there
        </button>
        <button
          type="button"
          onClick={moveHere}
          disabled={!!busy}
          className="crayon-btn bg-[#fffdf7] text-xl"
        >
          Move it here
        </button>
      </div>
    );

  // done (add)
  return (
    <p
      role="status"
      className="flex animate-pop-in items-center justify-center gap-2 text-center font-hand text-2xl leading-tight"
    >
      <Icon name="check" size={28} /> Saved! {shown} signs you in now.
    </p>
  );
}
