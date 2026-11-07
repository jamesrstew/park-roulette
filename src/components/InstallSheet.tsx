"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/icons";
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
 * iPhone: illustrated Share → Add to Home Screen → Add, after copying the
 * crew link (an installed web app can start without Safari's sign-in, and the
 * link gets you right back in). Android: a real one-tap install.
 */
export function InstallSheet({
  open,
  onClose,
  crewLink,
}: {
  open: boolean;
  onClose: () => void;
  /** The crew's join link. Copied first, so the app can always sign you in. */
  crewLink?: string;
}) {
  const platform = usePlatform();
  const androidReady = useAndroidPrompt();
  const [step, setStep] = useState<"offer" | "steps">("offer");
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
  }, [open]);

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
  const n = (i: number) => (crewLink ? i + 1 : i);

  return (
    <div className="fixed inset-0 z-[1250] flex items-end justify-center">
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
        className="doodle-box relative mx-3 mb-[max(env(safe-area-inset-bottom),0.75rem)] w-full max-w-md animate-pop-in px-5 pt-5 pb-5 shadow-[4px_6px_0_#2b2a33]"
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
            {crewLink && (
              <CopyRow copy={copy} crewLink={crewLink} onCopy={copyLink} />
            )}
          </div>
        ) : step === "offer" ? (
          <div className="mt-5 flex flex-col gap-3">
            <button
              type="button"
              data-autofocus
              className="crayon-btn wax bg-crayon-green py-3.5 text-2xl text-white"
              onClick={async () => {
                setStep("steps");
                await copyLink();
              }}
            >
              {crewLink ? "Copy my link & show me how" : "Show me how"}
            </button>
          </div>
        ) : (
          <ol className="mt-4 flex flex-col gap-3">
            {crewLink && (
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
                Tap <b className="text-crayon-blue">Add</b>. Then look for the
                wheel on your Home Screen!
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
        <b>Crew link copied.</b> If the app ever asks who you are, paste it.
      </span>
    );
  if (copy === "manual")
    return (
      <span className="flex w-full flex-col gap-1">
        <span>
          <b>Copy your crew link:</b> press and hold it, then tap Copy.
        </span>
        <input
          readOnly
          value={crewLink}
          onFocus={(e) => e.currentTarget.select()}
          className="field py-1.5 text-sm"
          aria-label="Your crew link"
        />
      </span>
    );
  if (compact)
    return (
      <span className="flex w-full items-center justify-between gap-2">
        <span>
          <b>Copy your crew link</b> so the app knows it&apos;s you.
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
      <Icon name="link" size={24} /> Copy my crew link
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
