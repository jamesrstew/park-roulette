import { addDays, pacific } from "./news/time";

/**
 * Ask moments: when the app may invite a family to the weekly picks
 * (Bend Playground Passport by email, the Weekend Pick by text). Pure, so
 * tests can pin any moment. Spec: /tmp/pr-news/ask-moments/spec.md.
 *
 * Three asks, one shared budget:
 *   next_pick     "You stamped {Park}!" above the wheel, at least 8 hours
 *                 after a stamp made on or after launch; email and text.
 *   rainy_spin    under a spin result, Monday to Wednesday, when the
 *                 coming Saturday or Sunday is wet in the park's town; email.
 *   weekend_spin  under a spin result, Thursday noon to Friday 3 pm; text.
 *
 * Exposures are counted per device (localStorage pr:asks): at most 1 a
 * day, 2 a week, 6 ever, and a moment ignored twice is retired. "No
 * thanks" and subscriptions follow the account when signed in; signed
 * out, the server reads the browser's pr_on cookie (lib/on-cookie.ts).
 */

export type Moment = "next_pick" | "rainy_spin" | "weekend_spin";

/** Where a device keeps its ask state (localStorage). */
export const ASKS_KEY = "pr:asks";
export type Channel = "email" | "text";

/** Stamps made before this Pacific date never trigger next_pick. */
export const ASK_LAUNCH = "2026-11-19";
export const CAPS = { day: 1, week: 2, lifetime: 6, ignored: 2 } as const;
/** next_pick waits this long after the stamp ("where next?", not "yay"). */
export const AFTER_STAMP_MS = 8 * 60 * 60 * 1000;
/** No ask at all this soon after a stamp (they're celebrating). */
export const QUIET_AFTER_STAMP_MS = 10 * 60 * 1000;
/** A device's first session: its first hour. */
export const FIRST_SESSION_MS = 60 * 60 * 1000;

/** One ask on screen on one day (Pacific). */
export type Exposure = {
  m: Moment;
  /** Pacific date. */
  d: string;
  /** The row was tapped (a chip, the field, No thanks): not ignored. */
  tapped?: boolean;
  /** Hidden with ×: ignored, and gone for today. */
  hidden?: boolean;
  /** next_pick: which stamp it was about. */
  stamp?: string;
};

export type AskState = {
  /** When this device first opened the app (ISO). */
  firstSeen?: string;
  exposures: Exposure[];
  /** No thanks, per channel. */
  no: Partial<Record<Channel, true>>;
  /** Signed up in this browser (or arrived from an email link). */
  on: Partial<Record<Channel, true>>;
};

export const EMPTY_STATE: AskState = { exposures: [], no: {}, on: {} };

export type Wet = { day: "Saturday" | "Sunday"; kind: "Rain" | "Snow" };

export type AskCtx = {
  /** idle: the Spin tab with no result; result: under a settled result. */
  surface: "idle" | "result";
  signedIn: boolean;
  isKid: boolean;
  /** Signed in from a borrowed family link (not trusted). */
  borrowed: boolean;
  /** A sheet, toast or milestone is open. */
  overlayOpen: boolean;
  /** Server truth for a signed-in grown-up. */
  account?: {
    emailOn: boolean;
    textsOn: boolean;
    emailNo: boolean;
    textNo: boolean;
    /** Said "Not now" to the old onboarding ask: one ignored next_pick. */
    legacyIgnored: boolean;
  };
  /** The crew's latest stamp. */
  lastStamp: { key: string; park: string; at: string } | null;
  /**
   * What this browser's pr_on cookie says it already gets (lib/on-cookie.ts),
   * read on the server: the signed-out truth, and a hint when signed in.
   */
  device?: { email: boolean; text: boolean };
  /** Weekend Pick texts are going out (and the number is known). */
  textsAvailable: boolean;
  /** The settled result under which rainy_spin or weekend_spin may show. */
  result?: { playable: boolean; wet: Wet | null } | null;
};

export type Ask =
  | { moment: "next_pick"; channels: Channel[]; park: string; stamp: string }
  | { moment: "rainy_spin"; channels: ["email"]; wet: Wet }
  | { moment: "weekend_spin"; channels: ["text"] };

/** Channels this family may still be offered. */
export function openChannels(
  ctx: AskCtx,
  state: AskState,
): Record<Channel, boolean> {
  const a = ctx.account;
  const d = ctx.device;
  return {
    email: !(
      state.on.email ||
      state.no.email ||
      d?.email ||
      a?.emailOn ||
      a?.emailNo
    ),
    text:
      ctx.textsAvailable &&
      !(state.on.text || state.no.text || d?.text || a?.textsOn || a?.textNo),
  };
}

/** Times a moment was shown and left with no tap (× included). */
export function ignoredCount(
  state: AskState,
  m: Moment,
  today: string,
): number {
  return state.exposures.filter(
    (e) => e.m === m && !e.tapped && (e.d < today || e.hidden),
  ).length;
}

/** May this moment take today's slot (the shared budget)? */
function budgetAllows(state: AskState, m: Moment, today: string): boolean {
  const todays = state.exposures.filter((e) => e.d === today);
  // Already this moment's day: it keeps showing (one exposure a day).
  if (todays.some((e) => e.m === m))
    return !todays.some((e) => e.m === m && e.hidden);
  if (todays.length >= CAPS.day) return false;
  const weekAgo = addDays(today, -6);
  if (state.exposures.filter((e) => e.d >= weekAgo).length >= CAPS.week)
    return false;
  return state.exposures.length < CAPS.lifetime;
}

/** The one ask to show now, or null. Priority: next_pick, then 2 or 3. */
export function pickAsk(ctx: AskCtx, state: AskState, now: Date): Ask | null {
  if (ctx.isKid || ctx.borrowed || ctx.overlayOpen) return null;
  const first = state.firstSeen ? Date.parse(state.firstSeen) : NaN;
  if (!(now.getTime() - first >= FIRST_SESSION_MS)) return null;
  if (
    ctx.lastStamp &&
    now.getTime() - Date.parse(ctx.lastStamp.at) < QUIET_AFTER_STAMP_MS
  )
    return null;
  const p = pacific(now);
  const today = p.date;
  const open = openChannels(ctx, state);
  const retired = (m: Moment) =>
    ignoredCount(state, m, today) +
      (m === "next_pick" && ctx.account?.legacyIgnored ? 1 : 0) >=
    CAPS.ignored;
  const ok = (m: Moment) => !retired(m) && budgetAllows(state, m, today);

  if (ctx.surface === "idle") {
    const s = ctx.lastStamp;
    if (!ctx.signedIn || !s) return null;
    if (pacific(new Date(s.at)).date < ASK_LAUNCH) return null;
    if (now.getTime() - Date.parse(s.at) < AFTER_STAMP_MS) return null;
    // Never on a second day for the same stamp.
    if (
      state.exposures.some(
        (e) => e.m === "next_pick" && e.stamp === s.key && e.d < today,
      )
    )
      return null;
    const channels = (["email", "text"] as const).filter((c) => open[c]);
    if (!channels.length || !ok("next_pick")) return null;
    return { moment: "next_pick", channels, park: s.park, stamp: s.key };
  }

  const r = ctx.result;
  if (!r || !r.playable) return null;
  // Monday to Wednesday: Thursday's email still lands before that weekend.
  if (p.weekday >= 1 && p.weekday <= 3) {
    if (r.wet && open.email && ok("rainy_spin"))
      return { moment: "rainy_spin", channels: ["email"], wet: r.wet };
    return null;
  }
  // Thursday noon to Friday 3 pm: the text arrives before the weekend.
  const weekendWindow =
    (p.weekday === 4 && p.minutes >= 12 * 60) ||
    (p.weekday === 5 && p.minutes < 15 * 60);
  if (weekendWindow && open.text && ok("weekend_spin"))
    return { moment: "weekend_spin", channels: ["text"] };
  return null;
}

// --- Recording (each returns a new state) -----------------------------------

/** The ask was at least half on screen: one exposure for the day. */
export function recordShown(state: AskState, ask: Ask, now: Date): AskState {
  const d = pacific(now).date;
  if (state.exposures.some((e) => e.m === ask.moment && e.d === d))
    return state;
  const e: Exposure = { m: ask.moment, d };
  if (ask.moment === "next_pick") e.stamp = ask.stamp;
  return { ...state, exposures: [...state.exposures, e].slice(-50) };
}

function markToday(
  state: AskState,
  m: Moment,
  now: Date,
  patch: Partial<Exposure>,
): AskState {
  const d = pacific(now).date;
  return {
    ...state,
    exposures: state.exposures.map((e) =>
      e.m === m && e.d === d ? { ...e, ...patch } : e,
    ),
  };
}

/** Any tap on the row (a chip, the field, No thanks). */
export const recordTapped = (state: AskState, m: Moment, now: Date) =>
  markToday(state, m, now, { tapped: true });

/** × (hide for now): counts as ignored. */
export const recordHidden = (state: AskState, m: Moment, now: Date) =>
  markToday(state, m, now, { hidden: true, tapped: false });

/** No thanks: those channels, forever. */
export function recordDeclined(
  state: AskState,
  channels: readonly Channel[],
): AskState {
  const no = { ...state.no };
  for (const c of channels) no[c] = true;
  return { ...state, no };
}

/**
 * The welcome sheet's picks page left the email box unchecked or empty:
 * one ignored next_pick, hidden for today (it never takes a slot today).
 */
export function recordPicksIgnored(state: AskState, now: Date): AskState {
  const d = pacific(now).date;
  if (state.exposures.some((e) => e.m === "next_pick" && e.d === d))
    return markToday(state, "next_pick", now, { hidden: true, tapped: false });
  return {
    ...state,
    exposures: [
      ...state.exposures,
      { m: "next_pick" as const, d, hidden: true },
    ].slice(-50),
  };
}

/** Signed up in this browser (or came from an email link). */
export function recordOn(state: AskState, channel: Channel): AskState {
  return { ...state, on: { ...state.on, [channel]: true } };
}

/** Parse what's in localStorage, forgiving anything odd. */
export function parseState(raw: string | null): AskState {
  try {
    const x = JSON.parse(raw ?? "null") as Partial<AskState> | null;
    if (!x || typeof x !== "object") return EMPTY_STATE;
    return {
      firstSeen: typeof x.firstSeen === "string" ? x.firstSeen : undefined,
      exposures: Array.isArray(x.exposures)
        ? x.exposures.filter(
            (e): e is Exposure =>
              !!e &&
              typeof e.d === "string" &&
              ["next_pick", "rainy_spin", "weekend_spin"].includes(e.m),
          )
        : [],
      no: x.no && typeof x.no === "object" ? x.no : {},
      on: x.on && typeof x.on === "object" ? x.on : {},
    };
  } catch {
    return EMPTY_STATE;
  }
}

/**
 * The weekend's first wet day, from weatherFor's verdicts (lib/events/
 * forecast.ts) and their lines: Snow when the words say snow or sleet.
 */
export function wetFrom(
  days: {
    day: "Saturday" | "Sunday";
    w: { wet: boolean; line: string } | null;
    /** The daytime chance of precipitation, percent. */
    pop?: number | null;
  }[],
): Wet | null {
  for (const { day, w, pop } of days)
    if (w?.wet && (pop ?? 0) >= WET_POP)
      return { day, kind: /snow|sleet/i.test(w.line) ? "Snow" : "Rain" };
  return null;
}

/** A wet day needs at least this chance of rain or snow (a "slight chance" isn't). */
export const WET_POP = 40;

/**
 * Moment 4, a label (not an ask): is it Thursday to Sunday of this
 * issue's week (Pacific)? Then its featured park shows "This weekend's
 * pick". The issue date is the latest one that featured the park.
 */
export function isThisWeekendsPick(
  issueDate: string | null,
  now: Date,
): boolean {
  if (!issueDate) return false;
  const today = pacific(now).date;
  return today >= issueDate && today <= addDays(issueDate, 3);
}
