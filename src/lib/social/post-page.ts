import type { SlideSpec } from "./model";

/**
 * What a post page (/social/<id>, Unpack and at home only) lists, from the
 * stored slides. Pure: the page hands in today's lookups (the catalog,
 * the stored events, the parks on our map), so a canceled or removed
 * event shows as such even though the slide still names it.
 */

type ItemSlide = Extract<SlideSpec, { t: "item" }>;
type IdeaSlide = Extract<SlideSpec, { t: "idea" }>;

export type ItemState =
  | "ok"
  | "canceled"
  | "postponed"
  | "rescheduled"
  /** The event's page is gone, or the park left the map. */
  | "removed";

export type ItemLink = {
  href: string;
  /** Another site (a venue's own page): opens with rel=noopener. */
  external: boolean;
  /** The Social tap's `to` label. */
  to: "event" | "park" | "venue";
  label: string;
};

export type PageItem = {
  n: number;
  name: string;
  what: string;
  facts: string[];
  place: string | null;
  host: string | null;
  state: ItemState;
  link: ItemLink | null;
};

export type Lookups = {
  venue: (id: string) => { name: string; url: string } | null;
  /** The event's status on that day, or null when its page is gone. */
  event: (
    slug: string,
    day: string,
  ) => { title: string; status: Exclude<ItemState, "removed"> } | null;
  park: (slug: string) => { name: string } | null;
};

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** The refs a stored Unpack draft handed in (older slides carry no ref). */
export function draftRefs(body: unknown): string[] {
  const items = (body as { items?: unknown } | null)?.items;
  return Array.isArray(items)
    ? items.flatMap((i) =>
        i && typeof i === "object" && typeof i.ref === "string" ? [i.ref] : [],
      )
    : [];
}

function nameOf(ref: string, L: Lookups): string | null {
  const [kind, rest] = [
    ref.slice(0, ref.indexOf(":")),
    ref.slice(ref.indexOf(":") + 1),
  ];
  if (kind === "venue") return L.venue(rest)?.name ?? null;
  if (kind === "park") return L.park(rest)?.name ?? null;
  if (kind === "event") {
    const [slug, day] = rest.split("@");
    return L.event(slug, day)?.title ?? null;
  }
  return null;
}

/** A slide's ref: its own, else the draft's ref whose name matches. */
function refFor(s: ItemSlide, refs: readonly string[], L: Lookups) {
  if (s.ref) return s.ref;
  return refs.find((r) => norm(nameOf(r, L) ?? "") === norm(s.name)) ?? null;
}

const STATE_OK = new Set(["ok", "canceled", "postponed", "rescheduled"]);

export function unpackItems(
  slides: readonly SlideSpec[],
  body: unknown,
  L: Lookups,
): PageItem[] {
  const refs = draftRefs(body);
  return slides
    .filter((s): s is ItemSlide => s.t === "item")
    .map((s): PageItem => {
      const base = {
        n: s.n,
        name: s.name,
        what: s.what,
        facts: s.facts,
        place: s.place ?? null,
        host: s.host ?? null,
      };
      const ref = refFor(s, refs, L);
      if (!ref) return { ...base, state: "ok", link: null };
      const rest = ref.slice(ref.indexOf(":") + 1);
      if (ref.startsWith("event:")) {
        const [slug, day] = rest.split("@");
        const e = L.event(slug, day);
        if (!e) return { ...base, state: "removed", link: null };
        return {
          ...base,
          state: STATE_OK.has(e.status) ? e.status : "ok",
          link: {
            href: `/events/${slug}`,
            external: false,
            to: "event",
            label: "See the event",
          },
        };
      }
      if (ref.startsWith("park:")) {
        const p = L.park(rest);
        return p
          ? {
              ...base,
              state: "ok",
              link: {
                href: `/parks/${rest}`,
                external: false,
                to: "park",
                label: "See the park",
              },
            }
          : { ...base, state: "removed", link: null };
      }
      if (ref.startsWith("venue:")) {
        const v = L.venue(rest);
        return v
          ? {
              ...base,
              state: "ok",
              link: {
                href: v.url,
                external: true,
                to: "venue",
                label: "Their website",
              },
            }
          : { ...base, state: "ok", link: null };
      }
      return { ...base, state: "ok", link: null };
    });
}

/** The state as the page prints it (null: nothing to say). */
export function stateLine(s: ItemState): string | null {
  switch (s) {
    case "canceled":
      return "Canceled";
    case "postponed":
      return "Postponed";
    case "rescheduled":
      return "Rescheduled: check the new date";
    case "removed":
      return "No longer listed";
    default:
      return null;
  }
}

export type PageIdea = Omit<IdeaSlide, "t" | "body" | "of" | "icon"> & {
  icon: string;
};

export function atHomeIdeas(slides: readonly SlideSpec[]): PageIdea[] {
  return slides
    .filter((s): s is IdeaSlide => s.t === "idea")
    .map((s) => ({
      n: s.n,
      icon: s.icon,
      title: s.title,
      ages: s.ages,
      need: s.need,
      steps: s.steps,
      payoff: s.payoff,
      safety: s.safety,
    }));
}

/** The post's headline slide words and kicker, for the page's title. */
export function headlineOf(slides: readonly SlideSpec[]): {
  words: string;
  highlight: string;
  kicker: string;
} | null {
  const h = slides.find((s) => s.t === "headline");
  return h && h.t === "headline"
    ? { words: h.words, highlight: h.highlight, kicker: h.kicker }
    : null;
}

// --- Park pairings ---------------------------------------------------------------

type PairSlide = Extract<SlideSpec, { t: "pair" }>;

export type PagePair = {
  n: number;
  place: string;
  park: string;
  town: string;
  apart: string;
  walk: boolean;
  trait: string;
  /** "At the park", "At the library", "This weekend". */
  label: string;
  /** Our park page, or null when the park left the map. */
  parkHref: string | null;
  /**
   * The anchor's link: our park or event page, or an indoor place's own
   * page (null when a park left the map or an event left the listing).
   */
  anchorLink: {
    href: string;
    label: string;
    to: "park" | "event" | "venue";
    external: boolean;
  } | null;
  /** The place's own verified site, else Google Maps by its place id. */
  placeLink: { href: string; label: string; to: "venue" | "maps" };
};

/** Google Maps for a place, by its place id alone (no Google content kept). */
export function mapsLink(placeId: string): string {
  return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`;
}

const SITE_RE = /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}\/$/i;

/** Each pairing of a park pairings post, with its links. */
const INDOOR_PAGE: Record<string, string> = {
  "At the library": "The library's page",
  "At the pool": "The pool's page",
  "At the play gym": "The play gym's page",
  "At the museum": "The museum's page",
};

function anchorLink(
  s: PairSlide,
  L: Pick<Lookups, "park"> & Partial<Pick<Lookups, "event">>,
): PagePair["anchorLink"] {
  const kind = s.kind ?? "park";
  if (kind === "park")
    return L.park(s.parkSlug)
      ? {
          href: `/parks/${s.parkSlug}`,
          label: "See the park",
          to: "park",
          external: false,
        }
      : null;
  if (kind === "event") {
    const [slug, day] = s.parkSlug.split("@");
    if (L.event && !L.event(slug, day)) return null;
    return {
      href: `/events/${slug}`,
      label: "See the event",
      to: "event",
      external: false,
    };
  }
  return s.href && /^https:\/\//.test(s.href)
    ? {
        href: s.href,
        label: INDOOR_PAGE[s.label ?? ""] ?? "Their page",
        to: "venue",
        external: true,
      }
    : null;
}

export function mashupPairs(
  slides: readonly SlideSpec[],
  L: Pick<Lookups, "park"> & Partial<Pick<Lookups, "event">>,
): PagePair[] {
  return slides
    .filter((s): s is PairSlide => s.t === "pair")
    .map((s) => ({
      n: s.n,
      place: s.place,
      park: s.park,
      town: s.town,
      apart: s.apart,
      walk: s.walk,
      trait: s.trait,
      label: s.label ?? "At the park",
      parkHref:
        (s.kind ?? "park") === "park" && L.park(s.parkSlug)
          ? `/parks/${s.parkSlug}`
          : null,
      anchorLink: anchorLink(s, L),
      placeLink:
        s.site && SITE_RE.test(s.site)
          ? { href: s.site, label: "Their website", to: "venue" }
          : {
              href: mapsLink(s.placeId),
              label: "Open in Maps",
              to: "maps",
            },
    }));
}
