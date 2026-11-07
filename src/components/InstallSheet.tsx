"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/icons";
import {
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
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    sfx.slide();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || platform === "none") return null;

  async function copyLink() {
    if (!crewLink) return;
    try {
      await navigator.clipboard.writeText(crewLink);
      setCopied(true);
      sfx.pop();
    } catch {
      window.prompt("Copy your crew link:", crewLink);
      setCopied(true);
    }
  }

  const later = () => {
    installLater();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[1250] flex items-end justify-center">
      <button
        type="button"
        aria-label="Close"
        onClick={later}
        className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]"
      />
      <div
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
              <button
                type="button"
                className="crayon-btn bg-paper text-lg"
                onClick={copyLink}
              >
                <Icon name={copied ? "check" : "link"} size={24} />
                {copied ? "Copied! Paste it in Safari" : "Copy my crew link"}
              </button>
            )}
          </div>
        ) : platform === "android" && androidReady ? (
          <div className="mt-5 flex flex-col gap-3">
            <button
              type="button"
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
          </div>
        ) : step === "offer" ? (
          <div className="mt-5 flex flex-col gap-3">
            <button
              type="button"
              className="crayon-btn wax bg-crayon-green py-3.5 text-2xl text-white"
              onClick={async () => {
                setStep("steps");
                await copyLink();
              }}
            >
              Show me how
            </button>
          </div>
        ) : (
          <ol className="mt-4 flex flex-col gap-3">
            {crewLink && (
              <Step n={1} done={copied}>
                <span>
                  {copied ? (
                    <>
                      <b>Crew link copied.</b> If the app ever asks who you are,
                      paste it.
                    </>
                  ) : (
                    <>
                      <b>Copy your crew link</b> so the app knows it&apos;s you.
                    </>
                  )}
                </span>
                {!copied && (
                  <button
                    type="button"
                    className="chip min-h-11 shrink-0"
                    onClick={copyLink}
                  >
                    Copy
                  </button>
                )}
              </Step>
            )}
            <Step n={crewLink ? 2 : 1}>
              <span>
                {platform === "android" ? (
                  <>
                    Tap the <b>⋮</b> menu in Chrome.
                  </>
                ) : (
                  <>
                    Tap{" "}
                    <Kbd>
                      <ShareGlyph /> Share
                    </Kbd>{" "}
                    in Safari.{" "}
                    <span className="text-ink-soft">
                      (Can&apos;t see it? Tap <b>•••</b> first.)
                    </span>
                  </>
                )}
              </span>
            </Step>
            <Step n={crewLink ? 3 : 2}>
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
            <Step n={crewLink ? 4 : 3}>
              <span>
                Tap <b className="text-crayon-blue">Add</b>. Then look for the
                wheel on your Home Screen!
              </span>
            </Step>
          </ol>
        )}

        <button
          type="button"
          onClick={step === "steps" ? onClose : later}
          className="mt-4 w-full font-hand text-xl text-ink-soft underline"
        >
          {step === "steps" ? "Got it!" : "Maybe later"}
        </button>
      </div>
    </div>
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
