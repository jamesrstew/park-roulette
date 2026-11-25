/**
 * Vercel Web Analytics custom events: one list, so names never drift.
 * Properties are small labels only: never names, numbers, codes, park IDs
 * tied to a person, or anything a person typed. (Vercel Pro allows two
 * properties per event.)
 *
 * Directions from a spin result carries {from: "spin", ask: "yes" | "no"}:
 * whether an ask was showing under the result (the Let's go! guardrail).
 *
 * The funnel: Code requested → Number verified → Family started / Joined a
 * family → Spin → Stamped (first: yes) → Review saved → Invite shared.
 */
export const EVENTS = {
  codeRequested: "Code requested",
  numberVerified: "Number verified",
  signedIn: "Signed in",
  familyStarted: "Family started",
  joinedFamily: "Joined a family",
  kidAdded: "Kid added",
  spin: "Spin",
  directions: "Directions",
  stamped: "Stamped",
  reviewSaved: "Review saved",
  inviteShared: "Invite shared",
  parkAdded: "Park added",
  parkFix: "Park fix",
  reportSent: "Report sent",
  installed: "Installed",
  /** Bend Playground Passport, with a `source` (footer, newsletter, ...). */
  emailSignup: "Email signup",
  /** Weekend texts, with a `source`. */
  textSignup: "Text signup",
  /**
   * Ask moments (lib/asks.ts), each with {moment, channel}: moment is
   * next_pick, rainy_spin or weekend_spin; channel is email, text or both.
   * Shown once a day per moment, when the row is half on screen.
   */
  askShown: "Ask shown",
  askOpened: "Ask opened",
  askDeclined: "Ask declined",
  /**
   * The welcome sheet's picks page, once per sheet, after the answers come
   * back or on Not now: {email: yes | blank | unchecked | already | failed
   * | closed, texts: yes | no | hidden | already | failed}.
   */
  signupPicks: "Signup picks",
  /**
   * The site footer's texts card for a signed-in grown-up with a fresh
   * code, once a day: {state: rather | too} (kept out of Ask shown).
   */
  footerTextShown: "Footer text shown",
  /**
   * A tap on The scoop (/news): {to: event | all_events | review | pick |
   * issue | indoor}. Labels only, never which park or event.
   */
  scoopTap: "Scoop tap",
  /**
   * A tap on the link-in-bio grid or a post page (/social): {source:
   * social_grid | social_post, to: park | issue | events | post | event |
   * venue | newsletter | press}. Where it leads by type only, never which post.
   */
  socialTap: "Social tap",
  /**
   * Saved and hidden kid events (/events). Labels only, never which event.
   * Saved: {from: card | row | page | date | again, kind: date | program}.
   * Unsaved: {from: card | row | page | date | shortlist}.
   * Hidden: {scope: event | series, from: card | row | page}.
   * Unhidden: {from: undo | list | page}.
   * Shortlist viewed: {n: 0 | 1-3 | 4+, signed: in | out}, once per visit.
   */
  eventSaved: "Event saved",
  eventUnsaved: "Event unsaved",
  eventHidden: "Event hidden",
  eventUnhidden: "Event unhidden",
  shortlistViewed: "Shortlist viewed",
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];
export type EventProps = Record<string, string | number | boolean>;

/** An event a server action hands back for the browser to record. */
export type Tracked = { name: EventName; props?: EventProps };

export const ev = (name: EventName, props?: EventProps): Tracked => ({
  name,
  props,
});

/**
 * Actions that redirect can't return an event; they add ?ev=<key> to the
 * address instead, and the browser records it and drops the param.
 */
export const URL_EVENTS: Record<string, Tracked> = {
  "start-home": ev(EVENTS.familyStarted, { via: "homepage" }),
  "start-friend": ev(EVENTS.familyStarted, { via: "friend link" }),
  join: ev(EVENTS.joinedFamily, { via: "family link" }),
  "park-added": ev(EVENTS.parkAdded),
};
