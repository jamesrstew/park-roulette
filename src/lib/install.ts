"use client";

import { storage } from "./storage";

/**
 * "Add to Home Screen" helpers. iPhones have no install prompt, so we teach
 * the Share → Add to Home Screen steps; Android Chrome fires
 * beforeinstallprompt, which we hold on to for a real one-tap install.
 */

export type InstallPlatform = "ios" | "android" | "in-app" | "none";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  // The root layout captures the event before any JS chunk loads (Chrome
  // fires it once, often right after load). Adopt it if we were late.
  const early = (window as Window & { __bip?: BeforeInstallPromptEvent }).__bip;
  if (early) deferred = early;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // we show our own, nicer prompt
    deferred = e as BeforeInstallPromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    storage.set(INSTALLED_KEY, "1");
    listeners.forEach((l) => l());
  });
}

const LATER_KEY = "pr:install-later";
const INSTALLED_KEY = "pr:installed";
/** After "Maybe later", wait this long before offering again in the first-run flow. */
const LATER_MS = 3 * 24 * 3600 * 1000;

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function installPlatform(): InstallPlatform {
  if (typeof navigator === "undefined" || isStandalone()) return "none";
  const ua = navigator.userAgent;
  // In-app browsers (Instagram, Facebook, Messenger, Snapchat…) can't install.
  if (
    /FBAN|FBAV|Instagram|Line\/|Snapchat|LinkedInApp|TikTok|musical_ly/i.test(
      ua,
    )
  )
    return "in-app";
  const ios =
    /iPhone|iPad|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (ios) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "none";
}

/** Words for the browser's own UI, so instructions match what's on screen. */
export function browserNames(): { share: string; menu: string } {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua))
    return { share: "Share", menu: "your browser" };
  if (/iPhone|iPad|iPod|Macintosh/.test(ua))
    return { share: "Share", menu: "Safari" };
  if (/SamsungBrowser|Firefox|OPR|EdgA/.test(ua))
    return { share: "Share", menu: "your browser" };
  return { share: "Share", menu: "Chrome" };
}

/** Installed (Android said so, or we've been opened from the Home Screen here). */
export function markedInstalled(): boolean {
  return storage.get(INSTALLED_KEY) === "1";
}

/** Should the first-run flow offer installing? (Me tab always can.) */
export function shouldOfferInstall(): boolean {
  if (installPlatform() === "none" || storage.get(INSTALLED_KEY) === "1")
    return false;
  const later = Number(storage.get(LATER_KEY) ?? 0);
  return !later || Date.now() - later > LATER_MS;
}

export function installLater() {
  storage.set(LATER_KEY, String(Date.now()));
}

export function canPromptAndroid() {
  return deferred !== null;
}

export function onInstallChange(l: () => void) {
  listeners.add(l);
  return () => void listeners.delete(l);
}

/** Android: show the real install prompt. Resolves true if they installed. */
export async function promptAndroidInstall(): Promise<boolean> {
  if (!deferred) return false;
  const e = deferred;
  deferred = null;
  await e.prompt();
  const { outcome } = await e.userChoice;
  if (outcome === "accepted") storage.set(INSTALLED_KEY, "1");
  listeners.forEach((l) => l());
  return outcome === "accepted";
}

const FIRST_OPEN_KEY = "pr:app-first-open";
/** True exactly once: the first time the app is opened from the Home Screen. */
export function takeFirstAppOpen(): boolean {
  if (!isStandalone() || storage.get(FIRST_OPEN_KEY) === "1") return false;
  storage.set(FIRST_OPEN_KEY, "1");
  storage.set(INSTALLED_KEY, "1");
  return true;
}
