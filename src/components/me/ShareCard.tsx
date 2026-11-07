"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { crayon } from "@/lib/crayons";
import { QrCode } from "./QrCode";

const noop = () => () => {};

function useOrigin() {
  return useSyncExternalStore(
    noop,
    () => window.location.origin,
    () => process.env.NEXT_PUBLIC_SITE_URL ?? "",
  );
}

function useCanShare() {
  return useSyncExternalStore(
    noop,
    () => typeof navigator.share === "function",
    () => false,
  );
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older iOS: fall back to a hidden textarea.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

export function ShareCard({
  emoji,
  title,
  blurb,
  warning,
  path,
  color,
  shareTitle,
  shareText,
  tilt = 0,
}: {
  emoji: string;
  title: string;
  blurb: string;
  warning?: string;
  path: string;
  color: string;
  shareTitle: string;
  shareText: string;
  tilt?: number;
}) {
  const origin = useOrigin();
  const canShare = useCanShare();
  const url = `${origin}${path}`;
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    if (await copyText(url)) {
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2200);
    }
  }

  async function share() {
    try {
      await navigator.share({ title: shareTitle, text: shareText, url });
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") copy();
    }
  }

  const hex = crayon(color);
  return (
    <section
      className="doodle-box relative px-4 pt-4 pb-4 shadow-[3px_4px_0_#2b2a33]"
      style={{ rotate: `${tilt}deg` }}
    >
      <div className="flex items-start gap-3">
        <span
          className="wax grid size-12 shrink-0 place-items-center rounded-[var(--radius-blob)] border-[2.5px] border-ink text-2xl"
          style={{ backgroundColor: hex }}
          aria-hidden
        >
          {emoji}
        </span>
        <div className="min-w-0">
          <h3 className="text-2xl">{title}</h3>
          <p className="text-[0.95rem] leading-snug text-ink-soft">{blurb}</p>
        </div>
      </div>

      {warning ? (
        <p className="mt-3 flex gap-2 rounded-xl bg-crayon-yellow/25 px-3 py-2 text-sm leading-snug">
          <span aria-hidden>🔒</span>
          <span>{warning}</span>
        </p>
      ) : null}

      <p
        className="mt-3 truncate rounded-lg border-2 border-dashed border-ink/30 bg-paper px-3 py-2 font-mono text-[0.8rem] text-ink-soft"
        title={url}
      >
        {url.replace(/^https?:\/\//, "")}
      </p>

      <div className="mt-3 flex gap-2">
        {canShare ? (
          <button
            type="button"
            onClick={share}
            className="crayon-btn wax flex-1 text-xl whitespace-nowrap text-white [text-shadow:1px_1px_0_#2b2a33]"
            style={{ backgroundColor: hex }}
          >
            Send 💌
          </button>
        ) : null}
        <button
          type="button"
          onClick={copy}
          className={`crayon-btn relative flex-1 text-xl whitespace-nowrap ${canShare ? "bg-[#fffdf7]" : "wax"}`}
          style={canShare ? undefined : { backgroundColor: hex }}
        >
          {copied ? (
            <>
              <span className="relative animate-pop-in">Copied!</span>
              <svg
                viewBox="0 0 120 80"
                className="pointer-events-none absolute -inset-1 h-[calc(100%+0.5rem)] w-[calc(100%+0.5rem)]"
                fill="none"
                aria-hidden
              >
                <path
                  d="M70 6 C 30 2, 4 20, 6 42 C 8 66, 50 78, 86 70 C 116 62, 120 34, 98 16 C 82 4, 50 6, 34 12"
                  stroke="#e5432f"
                  strokeWidth="4"
                  strokeLinecap="round"
                  className="draw-in"
                  style={{ ["--len" as string]: 330 }}
                />
              </svg>
            </>
          ) : (
            "Copy link"
          )}
        </button>
        <button
          type="button"
          onClick={() => setShowQr((s) => !s)}
          aria-expanded={showQr}
          aria-label={showQr ? "Hide QR code" : "Show QR code"}
          className="crayon-btn bg-[#fffdf7] px-3 text-xl"
        >
          <QrGlyph />
        </button>
      </div>
      <span className="sr-only" aria-live="polite">
        {copied ? "Link copied" : ""}
      </span>

      {showQr && origin ? (
        <div className="mt-4 flex animate-pop-in flex-col items-center gap-2">
          <div className="doodle-box-alt rotate-1 bg-white p-2 shadow-[3px_4px_0_#2b2a33]">
            <QrCode
              text={url}
              label={`QR code for ${title}`}
              className="size-52"
            />
          </div>
          <p className="font-hand text-lg text-ink-soft">
            Point the other phone&apos;s camera here
          </p>
        </div>
      ) : null}
    </section>
  );
}

function QrGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" fill="none" aria-hidden>
      <g stroke="#2b2a33" strokeWidth="2.2" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
      </g>
      <g fill="#2b2a33">
        <rect x="14" y="14" width="3" height="3" />
        <rect x="18" y="18" width="3" height="3" />
        <rect x="18" y="14" width="3" height="2" />
        <rect x="14" y="19" width="2" height="2" />
      </g>
    </svg>
  );
}
