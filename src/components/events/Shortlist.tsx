"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/icons";
import { CrayonLoading } from "@/components/Loading";
import { shortlistInfo } from "@/lib/client-actions";
import { EVENTS } from "@/lib/events";
import { trackEvent } from "@/lib/events-client";
import { type SaveRef, splitKey } from "@/lib/events/prefs";
import { getSignedIn, save, subscribe, toast } from "@/lib/events/prefs-store";
import type { ShortFact } from "@/lib/events/shortlist";
import { usePrefs } from "./SaveHide";

/**
 * /events/saved: the family's (or this phone's) shortlist, built in the
 * browser from the phone's store and fresh public facts (shortlistInfo,
 * a POST: never a URL). Changes lead; then Today, This weekend, Coming
 * up, Our regulars; Past folds away.
 */

const noop = () => () => {};
const GROUPS = [
  ["today", "Today"],
  ["weekend", "This weekend"],
  ["later", "Coming up"],
  ["regular", "Our regulars"],
] as const;

function bucket(n: number) {
  return n === 0 ? "0" : n <= 3 ? "1-3" : "4+";
}

/** iPhone Safari, not from the Home Screen: storage can be cleared. */
function safariTab(): boolean {
  const ua = navigator.userAgent;
  const standalone =
    (navigator as { standalone?: boolean }).standalone === true ||
    window.matchMedia?.("(display-mode: standalone)").matches;
  return /iPhone|iPad|iPod/.test(ua) && !standalone;
}

export function Shortlist() {
  const ready = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
  const prefs = usePrefs();
  const signedIn = useSyncExternalStore(subscribe, getSignedIn, () => null);
  const keys = Object.keys(prefs.saves).sort();
  const want = keys.join(",");
  const [facts, setFacts] = useState<{
    want: string;
    list: ShortFact[];
  } | null>(null);
  const [failed, setFailed] = useState(false);
  const viewed = useRef(false);

  useEffect(() => {
    if (!ready) return;
    const refs = want
      .split(",")
      .map(splitKey)
      .filter((r): r is SaveRef => !!r);
    if (!refs.length) return;
    let live = true;
    void shortlistInfo(refs).then((r) => {
      if (!live) return;
      if (r.ok && "facts" in r && r.facts) {
        setFacts({ want, list: r.facts });
        setFailed(false);
      } else setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [ready, want]);

  useEffect(() => {
    if (!ready || viewed.current || signedIn === null) return;
    viewed.current = true;
    trackEvent(EVENTS.shortlistViewed, {
      n: bucket(keys.length),
      signed: signedIn ? "in" : "out",
    });
  }, [ready, signedIn, keys.length]);

  if (!ready) return <CrayonLoading label="Opening your list…" />;
  if (!keys.length) return <Empty />;

  // Facts for the keys still saved (a removal shows at once).
  const byKey = new Map((facts?.list ?? []).map((f) => [f.key, f]));
  const items = keys
    .map((k) => byKey.get(k))
    .filter((f): f is ShortFact => !!f);
  const loading = !facts || (items.length < keys.length && !failed);

  const nudge =
    signedIn === false ? <SignInNudge safari={safariTab()} /> : null;

  if (loading && !items.length)
    return (
      <>
        {failed ? (
          <FirstPaint keys={keys} note="Couldn't check for changes just now." />
        ) : (
          <FirstPaint keys={keys} />
        )}
        {nudge}
        <AllEvents />
      </>
    );

  const changed = items.filter((f) => f.show.changed);
  const past = items
    .filter((f) => f.show.group === "past")
    .sort((a, b) => b.show.sort.localeCompare(a.show.sort));
  return (
    <>
      {changed.length ? (
        <a
          href={`#s-${changed[0].key.replace(/[^a-z0-9-]/g, "_")}`}
          className="doodle-box flex min-h-12 items-center gap-2 bg-[color-mix(in_srgb,var(--color-crayon-yellow)_40%,#fffdf7)] px-4 py-2 font-hand text-xl"
        >
          <Icon name="warning" size={26} />
          {changed.length === 1
            ? "1 of your plans changed"
            : `${changed.length} of your plans changed`}
          <span aria-hidden className="ml-auto">
            ↓
          </span>
        </a>
      ) : null}
      {GROUPS.map(([g, name]) => {
        const list = items
          .filter((f) => f.show.group === g)
          .sort((a, b) => a.show.sort.localeCompare(b.show.sort));
        if (!list.length) return null;
        return (
          <section
            key={g}
            aria-labelledby={`h-${g}`}
            className="flex flex-col gap-2"
          >
            <h2 id={`h-${g}`} className="font-hand text-3xl">
              {name}
            </h2>
            {g === "regular" ? (
              <p className="-mt-2 leading-snug text-ink-soft">
                Always their next date.
              </p>
            ) : null}
            <ul className="doodle-box flex flex-col divide-y divide-dashed divide-ink/25 px-3">
              {list.map((f) => (
                <Item key={f.key} f={f} />
              ))}
            </ul>
          </section>
        );
      })}
      {past.length ? (
        <details className="group">
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 font-hand text-2xl [&::-webkit-details-marker]:hidden">
            Past ({past.length})
            <span
              aria-hidden
              className="transition-transform group-open:rotate-180"
            >
              ▾
            </span>
          </summary>
          <p className="leading-snug text-ink-soft">
            They leave this list a month after.
          </p>
          <ul className="mt-2 flex flex-col divide-y divide-dashed divide-ink/25 px-1">
            {past.map((f) => (
              <Item key={f.key} f={f} />
            ))}
          </ul>
        </details>
      ) : null}
      {nudge}
      <AllEvents />
    </>
  );
}

function AllEvents() {
  return (
    <Link
      href="/events"
      className="crayon-btn wax min-h-12 self-start bg-crayon-green px-5 text-xl text-white [text-shadow:1px_1px_0_#2b2a33]"
    >
      All kids&apos; events
    </Link>
  );
}

/** Before the facts come back: the titles this phone kept, in date order. */
function FirstPaint({ keys, note }: { keys: string[]; note?: string }) {
  const prefs = usePrefs();
  return (
    <div className="flex flex-col gap-2">
      {note ? <p className="text-ink-soft">{note}</p> : null}
      <ul className="doodle-box flex flex-col divide-y divide-dashed divide-ink/25 px-3">
        {keys.map((k) => {
          const s = prefs.saves[k];
          const ref = splitKey(k)!;
          return (
            <li key={k} className="py-3">
              <Link
                href={`/events/${ref.slug}`}
                className="font-hand text-xl leading-tight underline decoration-2 underline-offset-4"
              >
                {s?.t || "A saved event"}
              </Link>
              {s?.w ? (
                <p className="text-[0.95rem] text-ink-soft">{s.w}</p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Tag({
  children,
  loud,
}: {
  children: React.ReactNode;
  loud?: boolean;
}) {
  return (
    <span
      className={`inline-flex min-h-7 items-center rounded-[var(--radius-wobbly-2)] border-2 border-ink px-2 font-hand text-base leading-tight ${loud ? "bg-crayon-red text-white [text-shadow:1px_1px_0_#2b2a33]" : "bg-[color-mix(in_srgb,var(--color-crayon-yellow)_45%,#fffdf7)]"}`}
    >
      {children}
    </span>
  );
}

function Item({ f }: { f: ShortFact }) {
  const prefs = usePrefs();
  const snap = prefs.saves[f.key];
  const title = f.title || snap?.t || "A saved event";
  const s = f.show;
  const struck = f.state === "canceled" || f.state === "moved";
  const remove = () => {
    save(f.slug, f.occ, false);
    trackEvent(EVENTS.eventUnsaved, { from: "shortlist" });
    toast({
      msg: `Took ${title} off your list.`,
      action: {
        label: "Undo",
        run: () => save(f.slug, f.occ, true, { t: title, w: snap?.w ?? "" }),
      },
    });
  };
  return (
    <li
      id={`s-${f.key.replace(/[^a-z0-9-]/g, "_")}`}
      className="flex scroll-mt-4 gap-3 py-3"
    >
      {f.regular ? (
        <span
          aria-hidden
          className="flex h-14 w-12 shrink-0 items-center justify-center rounded-[var(--radius-wobbly-2)] border-2 border-ink bg-[color-mix(in_srgb,var(--color-crayon-teal)_22%,#fffdf7)]"
        >
          <Icon name="calendar" size={28} />
        </span>
      ) : (
        <span
          aria-hidden
          className={`flex h-14 w-12 shrink-0 flex-col items-center justify-center rounded-[var(--radius-wobbly-2)] border-2 border-ink font-hand leading-none ${f.past ? "bg-paper text-ink-soft" : "bg-[color-mix(in_srgb,var(--color-crayon-yellow)_45%,#fffdf7)]"}`}
        >
          <span className="text-sm uppercase">{s.mon}</span>
          <span className="text-2xl">{s.dom}</span>
        </span>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h3 className="font-hand text-xl leading-tight">
          {f.state === "gone" ? (
            title
          ) : (
            <Link
              href={`/events/${f.slug}`}
              className="underline decoration-2 underline-offset-4"
            >
              {title}
            </Link>
          )}
        </h3>
        {s.when ? (
          <p className="text-[0.95rem] leading-snug">
            {f.regular ? "Next: " : ""}
            {struck ? <s>{s.when}</s> : s.when}
          </p>
        ) : null}
        {f.where ? (
          <p className="text-[0.95rem] leading-snug text-ink-soft">{f.where}</p>
        ) : null}
        <Status f={f} />
        {!f.past && (f.free || f.ages) ? (
          <div className="flex flex-wrap gap-1.5">
            {f.free ? <Tag>Free</Tag> : null}
            {f.ages ? <Tag>{f.ages}</Tag> : null}
          </div>
        ) : null}
        {s.again && f.next ? <AgainButton f={f} title={title} /> : null}
        {s.ics || s.directions ? (
          <div className="flex flex-wrap gap-x-4">
            {s.ics ? (
              <a
                href={s.ics}
                className="flex min-h-11 items-center gap-1.5 underline underline-offset-2"
              >
                <Icon name="calendar" size={20} />
                Add to calendar
              </a>
            ) : null}
            {s.directions ? (
              <a
                href={s.directions}
                className="flex min-h-11 items-center gap-1.5 underline underline-offset-2"
              >
                <Icon name="directions" size={20} />
                Directions
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        onClick={remove}
        aria-label={`Remove ${title} from your list`}
        className="-mr-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
      >
        <Icon name="heart" size={28} />
      </button>
    </li>
  );
}

function Status({ f }: { f: ShortFact }) {
  if (f.past) return null;
  switch (f.state) {
    case "canceled":
      return (
        <p className="leading-snug">
          <Tag loud>Canceled</Tag> per {f.by}.
        </p>
      );
    case "postponed":
      return (
        <p className="leading-snug">
          <Tag loud>Postponed</Tag> No new date yet.
        </p>
      );
    case "moved":
      return (
        <p className="leading-snug">
          <Tag loud>Date changed</Tag>{" "}
          {f.show.newDay ? (
            <>New date: {f.show.newDay}.</>
          ) : (
            <Link href={`/events/${f.slug}`} className="underline">
              See the new dates
            </Link>
          )}
        </p>
      );
    case "unconfirmed":
      return (
        <p className="leading-snug">
          <Tag>Check first</Tag> We couldn&apos;t confirm this one anymore.
        </p>
      );
    case "no_next":
      return (
        <p className="leading-snug text-ink-soft">
          No next date yet. We&apos;ll add it when it&apos;s announced.
        </p>
      );
    case "gone":
      return (
        <p className="leading-snug">
          <Tag loud>Off our list</Tag> This event came off our list.
        </p>
      );
    default:
      return null;
  }
}

function AgainButton({ f, title }: { f: ShortFact; title: string }) {
  const prefs = usePrefs();
  const occ = f.next!.occ;
  const on = !!prefs.saves[`${f.slug}|${occ}`];
  if (on) return null;
  return (
    <button
      type="button"
      onClick={() => {
        save(f.slug, occ, true, {
          t: title,
          w: `${f.show.again} · ${f.where}`,
        });
        trackEvent(EVENTS.eventSaved, { from: "again", kind: "date" });
        toast({ msg: `Saved ${f.show.again}.` });
      }}
      className="flex min-h-11 items-center gap-1.5 self-start underline underline-offset-2"
    >
      <Icon name="heart_empty" size={20} />
      Next one: {f.show.again}. Save it
    </button>
  );
}

function Empty() {
  return (
    <div className="doodle-box flex flex-col items-center gap-3 px-4 py-6 text-center">
      <Icon name="heart_empty" size={56} />
      <p className="font-hand text-2xl">Nothing saved yet.</p>
      <p className="leading-snug">
        Tap the heart on any event to keep it here.
      </p>
      <Link
        href="/events"
        className="crayon-btn wax min-h-12 bg-crayon-yellow px-5 text-xl"
      >
        See kids&apos; events
      </Link>
    </div>
  );
}

function SignInNudge({ safari }: { safari: boolean }) {
  return (
    <aside className="flex flex-col gap-2 rounded-2xl border-2 border-dashed border-ink/50 bg-white/60 px-4 py-3 leading-snug">
      <p>
        <b>Saved on this phone only.</b> Sign in to keep your list and share it
        with your family.
        {safari ? " Safari may clear it after a week away." : ""}
      </p>
      <Link
        href="/me?next=/events/saved"
        className="crayon-btn wax min-h-11 self-start bg-crayon-blue px-4 text-lg text-white [text-shadow:1px_1px_0_#2b2a33]"
      >
        Sign in
      </Link>
    </aside>
  );
}
