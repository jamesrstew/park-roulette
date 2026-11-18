/**
 * Vercel Web Analytics custom events: one list, so names never drift.
 * Properties are small labels only: never names, numbers, codes, park IDs
 * tied to a person, or anything a person typed. (Vercel Pro allows two
 * properties per event.)
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
