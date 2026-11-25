"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import { Icon } from "@/components/icons";
import { EVENTS } from "@/lib/events";
import { trackEvent } from "@/lib/events-client";
import { isHidden, saveKey } from "@/lib/events/prefs";
import {
  canSave,
  firstTime,
  getPrefs,
  getServerPrefs,
  getServerToast,
  getShowHidden,
  getSignedIn,
  getToast,
  hide,
  listingMounted,
  pauseToast,
  repaint,
  save,
  setShowHidden,
  subscribe,
  subscribeToast,
  sync,
  toast,
} from "@/lib/events/prefs-store";

/**
 * Save (♡) and Hide (×) on /events and the event pages. The listing is
 * server-rendered once for everyone; these read the phone's store. The
 * heart's look comes from the store's stylesheet ([data-sv]), so a saved
 * heart is filled on first paint; aria-pressed follows after hydration.
 */

export function usePrefs() {
  return useSyncExternalStore(subscribe, getPrefs, getServerPrefs);
}

function useShowHidden() {
  return useSyncExternalStore(subscribe, getShowHidden, () => false);
}

/** The events layout, outside Suspense: the stylesheet before paint (client navigations). */
export function PrefsPaint() {
  useLayoutEffect(() => repaint(), []);
  return null;
}

/** End of the listing: mark boxes and groups that are all hidden, before paint. */
export function PrefsMarks() {
  useLayoutEffect(() => listingMounted(), []);
  return null;
}

/** The events layout: tells the store who's here (signed in or not). */
export function EventPrefsSync({ signedIn }: { signedIn: boolean }) {
  useEffect(() => {
    void sync(signedIn);
  }, [signedIn]);
  return null;
}

type From = "card" | "row" | "page" | "date" | "again";

/**
 * The heart. `look`: "icon" (a 44px round target on cards and rows) or
 * "button" (a crayon button with words, on event pages).
 */
export function HeartButton({
  slug,
  occ,
  label,
  title,
  where,
  from,
  look = "icon",
  words,
}: {
  slug: string;
  occ: string;
  /** "Baby Storytime, Tue, Nov 25" (what's saved). */
  label: string;
  title: string;
  /** "Tue, Nov 25 · Downtown Library, Bend" (the shortlist's first paint). */
  where: string;
  from: From;
  look?: "icon" | "button";
  /** The button's words: [not saved, saved]. */
  words?: [string, string];
}) {
  const prefs = usePrefs();
  const router = useRouter();
  const key = saveKey(slug, occ);
  const on = !!prefs.saves[key];
  const tap = () => {
    if (!on && !canSave()) {
      toast({
        msg: "That's a lot of saved events! Remove a few you're done with first.",
      });
      return;
    }
    save(slug, occ, !on, { t: title, w: where });
    trackEvent(on ? EVENTS.eventUnsaved : EVENTS.eventSaved, {
      from,
      ...(on ? {} : { kind: occ ? "date" : "program" }),
    });
    if (!on && firstTime("save"))
      toast({
        msg: "Saved! It's on your list.",
        sub:
          getSignedIn() && getPrefs().owner
            ? "Your family sees it too."
            : undefined,
        action: {
          label: "See it",
          run: () => router.push("/events/saved"),
        },
      });
  };
  const heart = (size: number) => (
    <>
      <span data-heart-off className="inline-flex">
        <Icon name="heart_empty" size={size} />
      </span>
      <span data-heart-on className="hidden">
        <Icon name="heart" size={size} />
      </span>
    </>
  );
  if (look === "button")
    return (
      <button
        type="button"
        data-sv={key}
        data-ev-focus
        aria-pressed={on}
        aria-label={`Save ${label}`}
        onClick={tap}
        className="crayon-btn wax flex min-h-12 items-center gap-2 bg-crayon-pink/30 px-4 text-xl"
      >
        {heart(24)}
        <span data-heart-off>{words?.[0] ?? "Save"}</span>
        <span data-heart-on className="hidden">
          {words?.[1] ?? "Saved"}
        </span>
      </button>
    );
  return (
    <button
      type="button"
      data-sv={key}
      data-ev-focus
      aria-pressed={on}
      aria-label={`Save ${label}`}
      onClick={tap}
      className="relative z-10 flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-transform active:scale-90 motion-reduce:transition-none"
    >
      {heart(28)}
    </button>
  );
}

/** Next heart after this one that's still on screen (focus after a hide). */
function nextFocus(from: HTMLElement): HTMLElement | null {
  const all = [
    ...document.querySelectorAll<HTMLElement>(
      "[data-ev-focus], [data-ev-x], [data-ev-hidden-line]",
    ),
  ];
  const i = all.indexOf(from);
  return (
    all.slice(i + 1).find((el) => el.offsetParent !== null) ??
    all
      .slice(0, Math.max(0, i))
      .reverse()
      .find((el) => el.offsetParent !== null) ??
    null
  );
}

/** The ×: hides a program (all its pages), with an Undo toast. */
export function HideButton({
  slugs,
  title,
  scope,
  from,
  places,
}: {
  slugs: string[];
  title: string;
  scope: "event" | "series";
  from: "card" | "row" | "page";
  /** "all 5 libraries", when it's more than one place. */
  places?: string | null;
}) {
  const prefs = usePrefs();
  const hidden = isHidden(prefs, slugs);
  const ref = useRef<HTMLButtonElement>(null);
  const tap = () => {
    if (hidden) {
      hide(slugs, false);
      trackEvent(EVENTS.eventUnhidden, {
        from: from === "page" ? "page" : "list",
      });
      toast({ msg: `${title} is back on your list.` });
      return;
    }
    hide(slugs, true);
    trackEvent(EVENTS.eventHidden, { scope, from });
    const family = getSignedIn() && getPrefs().owner;
    const tip = firstTime("hide");
    toast({
      msg: `${title} hidden${places ? ` (${places})` : ""}${family ? " for your family" : ""}.`,
      sub:
        tip && from !== "page" ? "It waits at the end of the list." : undefined,
      action: {
        label: "Undo",
        run: () => {
          hide(slugs, false);
          trackEvent(EVENTS.eventUnhidden, { from: "undo" });
          toast(null);
        },
      },
    });
    // The card is gone now: put focus on the next thing, not the page top.
    if (from !== "page" && ref.current) {
      const btn = ref.current;
      requestAnimationFrame(() => nextFocus(btn)?.focus());
    }
  };
  if (from === "page")
    return (
      <button
        type="button"
        ref={ref}
        aria-pressed={hidden}
        onClick={tap}
        className="flex min-h-11 items-center gap-1.5 self-start underline underline-offset-2"
      >
        <Icon name="close" size={18} />
        {hidden ? "Hidden from your list" : "Not for us? Hide it"}
      </button>
    );
  return (
    <button
      type="button"
      ref={ref}
      data-ev-x
      aria-pressed={hidden}
      aria-label={`Hide ${title}`}
      onClick={tap}
      className={`relative z-10 flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${hidden ? "border-2 border-dashed border-ink bg-paper" : "opacity-70"}`}
    >
      {hidden ? (
        <Icon name="undo" size={22} />
      ) : (
        <Icon name="close" size={18} />
      )}
    </button>
  );
}

/** "Hidden here: 3 · Show" at the end of a section (the untimed undo). */
export function HiddenLine({
  programs,
  where,
}: {
  programs: string[][];
  /** "Specials", "Regulars". */
  where: string;
}) {
  const prefs = usePrefs();
  const showing = useShowHidden();
  const n = programs.filter((p) => isHidden(prefs, p)).length;
  if (!n) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-ink-soft">
      {showing
        ? `Tap the arrow to bring one back.`
        : `${n} hidden in ${where} ·`}
      <button
        type="button"
        data-ev-hidden-line
        onClick={() => setShowHidden(!showing)}
        className="flex min-h-11 items-center text-ink underline underline-offset-2"
        aria-expanded={showing}
      >
        {showing ? "Done" : "Show them"}
      </button>
    </p>
  );
}

/** A group whose every item is hidden (revealed by the stylesheet). */
export function AllHidden() {
  return (
    <p
      data-ev-allhidden
      className="hidden flex-wrap items-center gap-x-2 rounded-2xl border-2 border-dashed border-ink/40 bg-white/50 px-3 py-1 leading-snug"
    >
      You hid everything here.
      <button
        type="button"
        onClick={() => setShowHidden(true)}
        className="flex min-h-11 items-center underline underline-offset-2"
      >
        Show them
      </button>
    </p>
  );
}

/** A count that leaves out hidden programs ("Regulars (39)"). */
export function LiveCount({ programs }: { programs: string[][] }) {
  const prefs = usePrefs();
  const showing = useShowHidden();
  return (
    <>
      {showing
        ? programs.length
        : programs.filter((p) => !isHidden(prefs, p)).length}
    </>
  );
}

/** "Show 12 more special events", leaving out hidden ones. */
export function MoreLabel({ programs }: { programs: string[][] }) {
  const prefs = usePrefs();
  const showing = useShowHidden();
  const n = showing
    ? programs.length
    : programs.filter((p) => !isHidden(prefs, p)).length;
  return <>{`Show ${n} more special ${n === 1 ? "event" : "events"}`}</>;
}

/** "♡ Saved (3)" at the end of the filter row: a link, never a filter. */
export function SavedLink() {
  const prefs = usePrefs();
  const n = Object.keys(prefs.saves).length;
  return (
    <Link
      href="/events/saved"
      className="chip min-h-11 shrink-0 justify-center gap-1"
      aria-label={n ? `Saved events, ${n}` : "Saved events"}
    >
      <Icon name={n ? "heart" : "heart_empty"} size={20} />
      Saved{n ? ` (${n})` : ""}
    </Link>
  );
}

/** The toast, above the bottom nav: Undo for a hide, a one-time tip. */
export function PrefsToast() {
  const t = useSyncExternalStore(subscribeToast, getToast, getServerToast);
  // The live region stays mounted, so screen readers hear each message.
  return (
    <div role="status" aria-live="polite">
      {t ? (
        <div
          onPointerEnter={() => pauseToast(true)}
          onPointerLeave={() => pauseToast(false)}
          onFocus={() => pauseToast(true)}
          onBlur={() => pauseToast(false)}
          className="doodle-box fixed inset-x-3 bottom-[calc(max(env(safe-area-inset-bottom),0.6rem)+5.5rem)] z-[1100] mx-auto flex max-w-md animate-pop-in items-center gap-3 bg-[#fffdf7] py-2 pr-2 pl-4 shadow-[3px_4px_0_#2b2a33]"
        >
          <p className="flex-1 leading-snug">
            {t.msg}
            {t.sub ? (
              <span className="block text-sm text-ink-soft">{t.sub}</span>
            ) : null}
          </p>
          {t.action ? (
            <button
              type="button"
              onClick={() => {
                pauseToast(false);
                t.action!.run();
                toast(null);
              }}
              className="crayon-btn wax min-h-11 shrink-0 bg-crayon-yellow px-4 text-lg"
            >
              {t.action.label}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** On an event page that's hidden: say so, with the way back. */
export function HiddenNote({
  slugs,
  title,
}: {
  slugs: string[];
  title: string;
}) {
  return (
    <div
      role="note"
      data-ev-if-hidden={slugs.join(" ")}
      className="doodle-box hidden flex-wrap items-center gap-x-2 px-4 py-2 leading-snug"
    >
      You hid this from your events list.
      <button
        type="button"
        onClick={() => {
          hide(slugs, false);
          trackEvent(EVENTS.eventUnhidden, { from: "page" });
          toast({ msg: `${title} is back on your list.` });
        }}
        className="flex min-h-11 items-center underline underline-offset-2"
      >
        Show it again
      </button>
    </div>
  );
}

/** Passport: "Saved events (3)" when there's anything saved (no URL bar on the Home Screen). */
export function SavedTile() {
  const prefs = usePrefs();
  const n = Object.keys(prefs.saves).length;
  if (!n) return null;
  return (
    <Link
      href="/events/saved"
      className="doodle-box flex min-h-14 items-center gap-3 px-4 py-2 transition-transform active:scale-[0.98]"
    >
      <Icon name="heart" size={32} />
      <span className="flex-1 font-hand text-2xl leading-tight">
        Saved events
        <span className="block font-body text-sm text-ink-soft">
          {n} on your list
        </span>
      </span>
      <span aria-hidden className="font-hand text-2xl">
        ›
      </span>
    </Link>
  );
}
