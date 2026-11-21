import { addDays, pacific } from "@/lib/news/time";
import { lineNamesEvent } from "./binding";
import { onPage } from "./structured";
import { organizerVerdict, pageNamesEvent } from "./validate";
import {
  type EventDate,
  type EventRow,
  type EventStatus,
  lastEnd,
  pacificAt,
  statusOn,
  upcomingDates,
} from "./model";

/**
 * Kids' events, the pure state rules: what's listed, the nightly check's
 * verdicts, and what IndexNow and the sitemap hear. No database here.
 */

/** On the listing: confirmed, a kids' event, with a date in the next 60 days. */
export function listed(
  e: EventRow,
  now: Date,
  /** Its dates not over yet, when the caller already has them. */
  upcoming: readonly EventDate[] = upcomingDates(e.data, now),
): boolean {
  if (e.confirm !== "ok" || e.data.ages?.kids === false) return false;
  const today = pacific(now).date;
  const next = upcoming[0];
  return !!next && next.day <= addDays(today, 60);
}

/** A page search engines should see: listed, or a canceled one until its date. */
export function indexable(e: EventRow, now: Date): boolean {
  return listed(e, now);
}

/** canceled: the page loaded and says this event is canceled. */
export type CheckOutcome = "seen" | "miss" | "unknown" | "canceled";

/** A challenge or firewall page's words (served with any status). */
const CHALLENGE =
  /just a moment|checking (your|if the site connection is) (browser|secure)|verify (that )?you are (a )?human|attention required|access denied|request blocked|enable javascript and cookies|ddos protection/i;

/** A short page that's a wall, not the event's page. */
export function looksLikeChallenge(text: string): boolean {
  return text.length < 3000 && CHALLENGE.test(text);
}

/**
 * One night's look at the official page. A real miss is a page that
 * loaded without the quote (in its text or its structured data), or a
 * 404 or 410. A timeout, a 5xx, a bot wall (403, 429, a challenge page,
 * even one served as 200) or a redirect off the allowlist is "unknown":
 * keep the last state and try again tomorrow. On a known-walled host
 * (catalog walled_hosts), a short page without the quote is unknown too:
 * a wall we didn't recognize is never a miss.
 */
export function judge(
  r: { status: number; text: string; data?: string; blocked?: string } | null,
  quote: string,
  opts: { walled?: boolean; title?: string } = {},
): CheckOutcome {
  if (!r || r.blocked) return "unknown";
  if (r.status === 404 || r.status === 410) return "miss";
  if (r.status !== 200) return "unknown";
  if (!r.text && !r.data) return "unknown"; // empty, or over the size cap
  // A data line counts only when it names the event (lib/events/binding.ts).
  if (onPage(r, quote, opts.title)) return "seen";
  if (opts.title && cancellationOf(r, opts.title)) return "canceled";
  if (looksLikeChallenge(r.text)) return "unknown";
  if (opts.walled && r.text.length < 3000) return "unknown";
  return "miss";
}

/**
 * One night's look at an event verified on a newsletter's listing (the
 * organizer's site keeps the checker out). The organizer's page decides
 * when it answers (organizerVerdict): canceled when it says so, a miss
 * when it's gone, lacks the event or prints another date, seen when it
 * names the event on its date. A wall there (403, 429, 5xx, a bot check,
 * a reset, a timeout) is unknown, never a miss. Then the listing is
 * judged like any page, except that a listing that's gone (an archived
 * issue taken down) is unknown too, not a miss.
 */
export function judgeListing(
  organizer: Parameters<typeof organizerVerdict>[0],
  listing: Parameters<typeof judge>[0],
  quote: string,
  title: string,
  day: string,
): CheckOutcome {
  if (organizer?.status === 200 && !organizer.blocked) {
    const r = { text: organizer.text ?? "", data: organizer.data };
    if (pageNamesEvent(r, title) && cancellationOf(r, title)) return "canceled";
  }
  const org = organizerVerdict(organizer, {
    title,
    dates: [{ day }],
    recurring: true,
  });
  if (org.cut) return "miss";
  if (!org.trusted) return "seen";
  const l = judge(listing, quote, { title });
  if (
    l === "miss" &&
    listing &&
    (listing.status === 404 || listing.status === 410)
  )
    return "unknown";
  return l;
}

/** Days unknown before a listing event leaves the listing. */
export const LISTING_UNKNOWN_DAYS = 14;
/** An issue older than this (days) no longer holds a listing event up. */
export const LISTING_ISSUE_MAX_AGE = 56;

/**
 * The "days unseen" a listing event's unknown night counts as: none
 * until it has been unknown for 14 days or its issue is older than 8
 * weeks, then past any limit (it leaves the listing until it's seen).
 */
export function listingUnseenDays(
  unseenDays: number,
  issued: string | null,
  today: string,
): number {
  const age = issued
    ? (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${issued}T12:00:00Z`)) /
      86_400_000
    : 0;
  return unseenDays >= LISTING_UNKNOWN_DAYS || age > LISTING_ISSUE_MAX_AGE
    ? Number.POSITIVE_INFINITY
    : 0;
}

export { issueDay } from "./validate";

const CANCELED = /\bcancell?ed\b/i;
const NOT_CANCELED =
  /\b(not|no|never|isn'?t|wasn'?t)\s+(been\s+|be\s+)?cancell?ed\b|\bunless\s+cancell?ed\b/i;

/**
 * The page says this event is canceled: "canceled" or "cancelled" in the
 * same sentence (or data line) as the event's title. Returns that
 * sentence (the new status quote), or null.
 */
export function cancellationOf(
  r: { text: string; data?: string },
  title: string,
): string | null {
  const parts = [
    ...r.text.split(/(?<=[.!?])\s+/),
    ...(r.data ? r.data.split("\n") : []),
  ];
  for (const p of parts)
    if (
      p.length <= 400 &&
      CANCELED.test(p) &&
      !NOT_CANCELED.test(p) &&
      lineNamesEvent(p, title)
    )
      return p.trim();
  return null;
}

/** Days unseen (the page never answered) before an event leaves the listing. */
export const UNKNOWN_DAYS_TO_UNCONFIRM = 7;

/** Misses in a row before an event is "couldn't confirm". */
export const MISSES_TO_UNCONFIRM = 2;
/** Nights seen in a row before an unconfirmed event is confirmed again. */
export const SEENS_TO_RECONFIRM = 2;

type CheckState = {
  confirm: "ok" | "unconfirmed";
  misses: number;
  seenStreak: number;
};

/** The next state after one night (pure, for tests). */
export function afterCheck(
  prev: CheckState | { confirm: "ok" | "unconfirmed"; misses: number },
  outcome: CheckOutcome,
  /** Days since the quote was last seen (or the event was stored). */
  unseenDays = 0,
): CheckState & { seen: boolean } {
  const p = { seenStreak: 0, ...prev };
  // Unknown keeps the last state, but not forever: a page that hasn't
  // answered for more than 7 days leaves the listing until it's seen.
  if (outcome === "unknown")
    return {
      ...p,
      confirm:
        unseenDays > UNKNOWN_DAYS_TO_UNCONFIRM ? "unconfirmed" : p.confirm,
      seen: false,
    };
  // Canceled is a status change (the caller records it), and the page
  // was there.
  if (outcome === "canceled")
    return { ...p, misses: 0, seenStreak: 0, seen: true };
  if (outcome === "seen") {
    const seenStreak = p.seenStreak + 1;
    return {
      confirm:
        p.confirm === "ok" || seenStreak >= SEENS_TO_RECONFIRM
          ? "ok"
          : "unconfirmed",
      misses: 0,
      seenStreak,
      seen: true,
    };
  }
  const misses = p.misses + 1;
  return {
    confirm: misses >= MISSES_TO_UNCONFIRM ? "unconfirmed" : p.confirm,
    misses,
    seenStreak: 0,
    seen: false,
  };
}

/**
 * What tonight's check looks at: the next upcoming date's own page and
 * quote, or, when that date is canceled, postponed or rescheduled, the
 * status quote (whose page is the official one).
 */
export function checkTarget(
  row: Pick<EventRow, "data" | "status">,
  now: Date,
): { url: string; quote: string; status: EventStatus; next: EventDate } | null {
  const next = upcomingDates(row.data, now)[0];
  if (!next) return null;
  const status = statusOn(row.data, next.day, row.status);
  if (status !== "scheduled" && row.data.status?.quote)
    return { url: row.data.url, quote: row.data.status.quote, status, next };
  const t = row.data.targets?.[next.day];
  return {
    url: t?.url ?? row.data.url,
    quote: t?.quote ?? row.data.checkQuote,
    status,
    next,
  };
}

/** The status shown now: the next date's (sticky per date). */
export function nextStatus(
  row: EventRow,
  now: Date,
  upcoming: readonly EventDate[] = upcomingDates(row.data, now),
): EventStatus {
  const next = upcoming[0];
  return next ? statusOn(row.data, next.day, row.status) : row.status;
}

/** When an event enters the 60-day listing: its next date minus 60 days. */
export function listingEntry(row: EventRow, now: Date): Date | null {
  const next = upcomingDates(row.data, now)[0];
  if (!next) return null;
  const t = pacificAt(addDays(next.day, -60));
  return t <= now ? t : null;
}

// --- IndexNow and the sitemap -----------------------------------------------------

export type EventChange = { url: string; changedAt: string; why: string };

/**
 * Event pages whose state changed since `since`: passed (their last date
 * ended), couldn't confirm or confirmed again, canceled, postponed or
 * rescheduled. New and changed upcoming pages are in the sitemap.
 */
export function eventChanges(
  rows: EventRow[],
  since: Date,
  now: Date,
  site: string,
): EventChange[] {
  const out: EventChange[] = [];
  for (const e of rows) {
    const url = `${site}/events/${e.slug}`;
    const end = lastEnd(e.data);
    if (end > since && end <= now)
      out.push({ url, changedAt: end.toISOString(), why: "passed" });
    if (e.stateChangedAt && e.stateChangedAt > since)
      out.push({
        url,
        changedAt: e.stateChangedAt.toISOString(),
        why: e.confirm === "unconfirmed" ? "unconfirmed" : nextStatus(e, now),
      });
    const entry = listingEntry(e, now);
    if (entry && entry > since && e.confirm === "ok")
      out.push({ url, changedAt: entry.toISOString(), why: "listed" });
  }
  return out;
}

/** A page's lastmod: its facts, or the day it entered the listing. */
export function eventLastmod(e: EventRow, now: Date): Date {
  const entry = listingEntry(e, now);
  return entry && entry > e.factsChangedAt ? entry : e.factsChangedAt;
}

/**
 * /events changes when the listed set does: a fact change on a listed
 * event, or one dropping off (it passed, or couldn't be confirmed).
 */
export function listingChangedAt(rows: EventRow[], now: Date): Date | null {
  const times = rows.flatMap((e) => {
    const t: number[] = [];
    if (listed(e, now)) t.push(eventLastmod(e, now).getTime());
    const end = lastEnd(e.data).getTime();
    if (end <= now.getTime()) t.push(end);
    if (e.stateChangedAt) t.push(e.stateChangedAt.getTime());
    return t;
  });
  return times.length ? new Date(Math.max(...times)) : null;
}

/**
 * A town page's event times: listed events' lastmods, plus events in the
 * town that passed or dropped off (couldn't confirm).
 */
export function townEventsChangedAt(
  rows: EventRow[],
  townSlugOf: (e: EventRow) => string,
  slug: string,
  now: Date,
): number[] {
  return rows
    .filter((e) => townSlugOf(e) === slug)
    .flatMap((e) => {
      const t: number[] = [];
      if (listed(e, now)) t.push(eventLastmod(e, now).getTime());
      const end = lastEnd(e.data).getTime();
      if (end <= now.getTime()) t.push(end);
      if (e.confirm === "unconfirmed" && e.stateChangedAt)
        t.push(e.stateChangedAt.getTime());
      return t;
    });
}
