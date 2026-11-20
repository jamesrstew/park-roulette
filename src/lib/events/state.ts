import { addDays, pacific } from "@/lib/news/time";
import { normalizeText } from "@/lib/news/validate";
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
export function listed(e: EventRow, now: Date): boolean {
  if (e.confirm !== "ok" || e.data.ages?.kids === false) return false;
  const today = pacific(now).date;
  const next = upcomingDates(e.data, now)[0];
  return !!next && next.day <= addDays(today, 60);
}

/** A page search engines should see: listed, or a canceled one until its date. */
export function indexable(e: EventRow, now: Date): boolean {
  return listed(e, now);
}

export type CheckOutcome = "seen" | "miss" | "unknown";

/**
 * One night's look at the official page. A real miss is a page that
 * loaded without the quote, or a 404 or 410. A timeout, a 5xx, a bot wall
 * (403, 429) or a redirect off the allowlist is "unknown": keep the last
 * state and try again tomorrow.
 */
export function judge(
  r: { status: number; text: string } | null,
  quote: string,
): CheckOutcome {
  if (!r) return "unknown";
  if (r.status === 404 || r.status === 410) return "miss";
  if (r.status !== 200) return "unknown";
  if (!r.text) return "unknown"; // an empty page or one over the size cap
  return r.text.includes(normalizeText(quote)) ? "seen" : "miss";
}

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
): CheckState & { seen: boolean } {
  const p = { seenStreak: 0, ...prev };
  if (outcome === "unknown") return { ...p, seen: false };
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
export function nextStatus(row: EventRow, now: Date): EventStatus {
  const next = upcomingDates(row.data, now)[0];
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
