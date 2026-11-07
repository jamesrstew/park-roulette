"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/icons";
import { PhoneCode } from "@/components/PhoneCode";
import {
  browserNames,
  canPromptAndroid,
  installLater,
  installPlatform,
  onInstallChange,
  promptAndroidInstall,
  type InstallPlatform,
} from "@/lib/install";
import { sfx } from "@/lib/sound";

const usePlatform = () =>
  useSyncExternalStore<InstallPlatform>(
    () => () => {},
    installPlatform,
    () => "none",
  );
const useAndroidPrompt = () =>
  useSyncExternalStore(onInstallChange, canPromptAndroid, () => false);

/**
 * "Make it an app!" A bottom sheet that walks through Add to Home Screen.
 * An installed web app starts without Safari's sign-in, so first make sure
 * the app can tell it's you: your phone number (or, no phone, your crew
 * link). Then iPhone: illustrated Share → Add to Home Screen → Add.
 * Android: a real one-tap install.
 */
export function InstallSheet({
  open,
  onClose,
  crewLink,
  hasPhone,
  phoneSkipped,
  canAddPhone = true,
}: {
  open: boolean;
  onClose: () => void;
  /** The crew's join link: the way back in for people without a phone. */
  crewLink?: string;
  /** Signs in with a phone already? Then the app just asks for the number. */
  hasPhone?: boolean;
  /** They just said "no phone" in the welcome: go straight to the family link. */
  phoneSkipped?: boolean;
  /** This phone may add a number (a trusted sign-in). Defaults to yes. */
  canAddPhone?: boolean;
}) {
  const platform = usePlatform();
  const androidReady = useAndroidPrompt();
  const [step, setStep] = useState<"offer" | "steps">("offer");
  const [phoneAdded, setPhoneAdded] = useState(false);
  /** No phone: they chose the crew-link way back in. */
  const [useLink, setUseLink] = useState(false);
  const byPhone = hasPhone || phoneAdded;
  const needsPhone = !byPhone && !useLink && canAddPhone;
  /** "copied" only after a real clipboard write; "manual" shows the link to copy by hand. */
  const [copy, setCopy] = useState<"idle" | "copied" | "manual">("idle");
  const panel = useRef<HTMLDivElement>(null);
  const names = browserNames();

  // Every way out (Escape, backdrop, the bottom button) does the same thing:
  // before the steps it's "maybe later" (a snooze); after them it's just done.
  const latest = useRef({ step, onClose });
  useEffect(() => {
    latest.current = { step, onClose };
  });
  const dismiss = () => {
    if (latest.current.step === "offer") installLater();
    latest.current.onClose();
  };

  // On open: fresh state, a sound, focus into the sheet. On close: focus back.
  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reset each time the sheet opens */
    setStep("offer");
    setCopy("idle");
    setUseLink(!!phoneSkipped);
    /* eslint-enable react-hooks/set-state-in-effect */
    const opener = document.activeElement as HTMLElement | null;
    sfx.slide();
    const raf = requestAnimationFrame(() =>
      panel.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus(),
    );
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (latest.current.step === "offer") installLater();
      latest.current.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [open, phoneSkipped]);

  if (!open || platform === "none") return null;

  async function copyLink() {
    if (!crewLink) return;
    try {
      await navigator.clipboard.writeText(crewLink);
      setCopy("copied");
      sfx.pop();
    } catch {
      setCopy("manual"); // show it in a box they can press and hold to copy
    }
  }
  const linkStep = !byPhone && !!crewLink;
  /** The phone form sits up top, so the iPhone keyboard never covers it. */
  const phoneOnTop = needsPhone && step === "offer" && platform !== "in-app";
  const n = (i: number) => (linkStep ? i + 1 : i);

  /** Phone first: how the Home Screen app will know it's you. */
  const phoneFirst = (
    <div className="mt-4 flex flex-col gap-2">
      <p className="font-hand text-2xl leading-tight">
        First, add your number so the app always knows it&apos;s you.
      </p>
      <PhoneCode
        mode="add"
        autoFocus
        onDone={() => {
          setPhoneAdded(true);
          setStep("steps");
        }}
      />
      {crewLink ? (
        <button
          type="button"
          onClick={async () => {
            setUseLink(true);
            setStep("steps");
            await copyLink();
          }}
          className="min-h-11 font-hand text-lg text-ink-soft underline underline-offset-4"
        >
          No phone? Use the family link instead
        </button>
      ) : null}
    </div>
  );

  return (
    <div
      className={`fixed inset-0 z-[1250] flex justify-center ${phoneOnTop ? "items-start" : "items-end"}`}
    >
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={dismiss}
        className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-h"
        key={phoneOnTop ? "top" : "bottom"}
        className={`doodle-box relative mx-3 w-full max-w-md animate-pop-in px-5 pt-5 pb-5 shadow-[4px_6px_0_#2b2a33] ${
          phoneOnTop
            ? "mt-[max(env(safe-area-inset-top),1rem)]"
            : "mb-[max(env(safe-area-inset-bottom),0.75rem)]"
        }`}
      >
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- our own app icon route */}
          <img
            src="/apple-icon"
            alt=""
            width={76}
            height={76}
            className="shrink-0 animate-float rounded-[22%] shadow-[3px_4px_0_#2b2a33]"
          />
          <div>
            <h2 id="install-h" className="text-4xl leading-none">
              Make it an <span className="text-crayon-green">app!</span>
            </h2>
            <p className="mt-1 font-hand text-xl leading-tight text-ink-soft">
              One tap from your Home Screen. Full screen, no browser bars.
            </p>
          </div>
        </div>

        {platform === "in-app" ? (
          <div className="mt-4 flex flex-col gap-3">
            <p className="leading-snug">
              This page opened inside another app, which can&apos;t install it.
              Open it in <b>Safari</b> (or Chrome) first: tap <b>•••</b> or the
              compass, then <b>Open in browser</b>.
            </p>
            {crewLink && (
              <CopyRow
                copy={copy}
                crewLink={crewLink}
                onCopy={copyLink}
                autoFocus
              />
            )}
          </div>
        ) : needsPhone && step === "offer" ? (
          phoneFirst
        ) : platform === "android" && androidReady ? (
          <div className="mt-5 flex flex-col gap-3">
            <button
              type="button"
              data-autofocus
              className="crayon-btn wax bg-crayon-green py-3.5 text-2xl text-white"
              onClick={async () => {
                if (await promptAndroidInstall()) {
                  sfx.celebrate();
                  onClose();
                }
              }}
            >
              <Icon name="phone" size={28} /> Add to Home Screen
            </button>
            {linkStep && (
              <CopyRow copy={copy} crewLink={crewLink} onCopy={copyLink} />
            )}
          </div>
        ) : step === "offer" ? (
          <div className="mt-5 flex flex-col gap-3">
            <button
              type="button"
              data-autofocus
              className="crayon-btn wax bg-crayon-green py-3.5 text-2xl text-white"
              onClick={() => setStep("steps")}
            >
              Show me how
            </button>
          </div>
        ) : (
          <ol className="mt-4 flex flex-col gap-3">
            {linkStep && crewLink && (
              <Step n={1} done={copy === "copied"}>
                <CopyRow
                  copy={copy}
                  crewLink={crewLink}
                  onCopy={copyLink}
                  compact
                />
              </Step>
            )}
            <Step n={n(1)}>
              <span>
                {platform === "android" ? (
                  <>
                    Tap the <b>⋮</b> menu in {names.menu}.
                  </>
                ) : (
                  <>
                    Tap{" "}
                    <Kbd>
                      <ShareGlyph /> Share
                    </Kbd>
                    {names.menu === "Safari" ? " in Safari. " : ". "}
                    <span className="text-ink-soft">
                      (Can&apos;t see it? Tap <b>•••</b> first.)
                    </span>
                  </>
                )}
              </span>
            </Step>
            <Step n={n(2)}>
              <span>
                Tap{" "}
                <Kbd>
                  <PlusSquareGlyph /> Add to Home Screen
                </Kbd>
                {platform === "android"
                  ? " (or Install app)."
                  : ". Scroll down a little if you don't see it."}
              </span>
            </Step>
            <Step n={n(3)}>
              <span>
                Tap <b className="text-crayon-blue">Add</b>. Then open the wheel
                on your Home Screen
                {byPhone ? " and sign in with your number." : "!"}
              </span>
            </Step>
          </ol>
        )}

        <button
          type="button"
          onClick={dismiss}
          className="mt-4 min-h-11 w-full font-hand text-xl text-ink-soft underline"
        >
          {step === "steps" ? "Got it!" : "Maybe later"}
        </button>
      </div>
    </div>
  );
}

/** The crew link: copy it, or (if the clipboard says no) a box to copy by hand. */
function CopyRow({
  copy,
  crewLink,
  onCopy,
  compact,
  autoFocus,
}: {
  copy: "idle" | "copied" | "manual";
  crewLink: string;
  onCopy: () => void;
  compact?: boolean;
  autoFocus?: boolean;
}) {
  if (copy === "copied")
    return (
      <span>
        <b>Family link copied.</b> If the app ever asks who you are, paste it.
      </span>
    );
  if (copy === "manual")
    return (
      <span className="flex w-full flex-col gap-1">
        <span>
          <b>Copy your family link:</b> press and hold it, then tap Copy.
        </span>
        <input
          readOnly
          value={crewLink}
          onFocus={(e) => e.currentTarget.select()}
          className="field py-1.5 text-sm"
          aria-label="Your family link"
        />
      </span>
    );
  if (compact)
    return (
      <span className="flex w-full items-center justify-between gap-2">
        <span>
          <b>Copy your family link</b> so the app knows it&apos;s you.
        </span>
        <button
          type="button"
          className="chip min-h-11 shrink-0"
          onClick={onCopy}
        >
          Copy
        </button>
      </span>
    );
  return (
    <button
      type="button"
      {...(autoFocus ? { "data-autofocus": true } : {})}
      className="crayon-btn bg-paper text-lg"
      onClick={onCopy}
    >
      <Icon name="link" size={24} /> Copy my family link
    </button>
  );
}

function Step({
  n,
  done,
  children,
}: {
  n: number;
  done?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-3 leading-snug">
      <span
        className={`wax grid size-9 shrink-0 place-items-center rounded-full border-2 border-ink font-hand text-xl ${
          done ? "bg-crayon-green text-white" : "bg-crayon-yellow"
        }`}
        aria-hidden
      >
        {done ? <Icon name="check" size={20} /> : n}
      </span>
      <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
        {children}
      </span>
    </li>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border-2 border-ink bg-white px-1.5 py-px align-middle text-[0.95rem] whitespace-nowrap">
      {children}
    </span>
  );
}

/** Safari's own Share symbol, so it matches what they'll look for. */
function ShareGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="size-4" fill="none" aria-hidden>
      <path
        d="M10 2 L10 12 M6 6 L10 2 L14 6 M5 9 L4 9 L4 18 L16 18 L16 9 L15 9"
        stroke="#2f78d4"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusSquareGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="size-4" fill="none" aria-hidden>
      <rect
        x="3"
        y="3"
        width="14"
        height="14"
        rx="3.5"
        stroke="#2b2a33"
        strokeWidth="1.6"
      />
      <path
        d="M10 6.5 V13.5 M6.5 10 H13.5"
        stroke="#2b2a33"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
