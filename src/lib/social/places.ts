import { siteDomain } from "./handles";
import {
  type MashupPark,
  type MashupTheme,
  type Place,
  themeQueries,
} from "./mashup";

/**
 * Google Places API (New), for the park pairings: Text Search for the
 * theme's kind of place in each town that has a vetted park, fetched when
 * the post is made. Nothing here is stored: store.ts keeps only place ids
 * (which Google lets us keep) and the words we wrote from these facts.
 *
 * Terms: we read factual fields (open, good for children, kids' menu,
 * patio, sit-down, where it is, its name and website) and use the rating
 * and review count only to choose. No review text, no photos, no rating
 * is ever shown. The key is GOOGLE_PLACES_KEY (never logged, never
 * committed).
 *
 * The project's quota is small (about 100 searches a day), so a theme
 * costs about 5 or 6 searches, a make at most 15 and a day at most 60
 * (store.ts placesBudget, counted in places_usage).
 */

const SEARCH = "https://places.googleapis.com/v1/places:searchText";

/** Only the fields the rules read (each one is billed by its SKU). */
export const PLACE_FIELDS = [
  "id",
  "displayName",
  "location",
  "addressComponents",
  "businessStatus",
  "primaryType",
  "goodForChildren",
  "menuForChildren",
  "outdoorSeating",
  "dineIn",
  "rating",
  "userRatingCount",
  "websiteUri",
] as const;

/** Central Oregon, so "Sisters" or "Bend" never matches another state's. */
export const REGION = {
  low: { latitude: 43.4, longitude: -122.0 },
  high: { latitude: 44.9, longitude: -120.6 },
} as const;

/** Bend has many more places: its first query reads two pages. */
const PAGES: Record<string, number> = { Bend: 2 };

type Raw = {
  id?: string;
  displayName?: { text?: string };
  location?: { latitude?: number; longitude?: number };
  addressComponents?: { shortText?: string; types?: string[] }[];
  businessStatus?: string;
  primaryType?: string;
  goodForChildren?: boolean;
  menuForChildren?: boolean;
  outdoorSeating?: boolean;
  dineIn?: boolean;
  rating?: number;
  userRatingCount?: number;
  websiteUri?: string;
};

const bool = (v: unknown) => (typeof v === "boolean" ? v : null);
const num = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** One Places result as our Place, or null when it lacks an id, name or point. */
export function toPlace(r: Raw): Place | null {
  const lat = num(r.location?.latitude);
  const lng = num(r.location?.longitude);
  const name = r.displayName?.text?.trim();
  if (!r.id || !name || lat == null || lng == null) return null;
  const locality = (r.addressComponents ?? []).find((c) =>
    (c.types ?? []).includes("locality"),
  );
  return {
    placeId: r.id,
    name,
    town: locality?.shortText ?? null,
    lat,
    lng,
    businessStatus: r.businessStatus ?? null,
    primaryType: r.primaryType ?? null,
    goodForChildren: bool(r.goodForChildren),
    menuForChildren: bool(r.menuForChildren),
    outdoorSeating: bool(r.outdoorSeating),
    dineIn: bool(r.dineIn),
    rating: num(r.rating),
    userRatingCount: num(r.userRatingCount),
    domain: siteDomain(r.websiteUri ?? null),
  };
}

export class PlacesError extends Error {
  constructor(
    message: string,
    /** A per-minute hiccup or a server error: worth another try soon. */
    readonly retry = false,
    /**
     * Won't get better today (the day's quota or our own cap, a refused
     * key or request, the run's time): skip, don't throw and start over.
     */
    readonly fatal = false,
  ) {
    super(message);
  }
}

/** The key from the environment, or an error (never printed). */
export function placesKey(): string {
  const key = process.env.GOOGLE_PLACES_KEY;
  if (!key) throw new PlacesError("GOOGLE_PLACES_KEY is not set.");
  return key;
}

/** A 5xx or a per-minute 429 waits and tries again, this many times. */
const RETRIES = 2;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type PlacesOpts = {
  key: string;
  fetchImpl?: typeof fetch;
  backoffMs?: number;
  /**
   * Called before every request (retries too): throws a fatal PlacesError
   * when the make's or the day's budget is spent (store.ts placesBudget).
   */
  spend?: () => Promise<void>;
  /** No request starts after this instant (ms). */
  deadline?: number;
};

/** One page of Text Search (New). */
async function searchPage(
  textQuery: string,
  pageToken: string | null,
  { key, fetchImpl = fetch, backoffMs = 3_000, spend, deadline }: PlacesOpts,
): Promise<{ places: Place[]; next: string | null }> {
  for (let i = 0; ; i++) {
    if (deadline != null && Date.now() > deadline)
      throw new PlacesError("Places: out of time for this run", false, true);
    await spend?.();
    const res = await fetchImpl(SEARCH, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": key,
        "x-goog-fieldmask": [
          ...PLACE_FIELDS.map((f) => `places.${f}`),
          "nextPageToken",
        ].join(","),
      },
      body: JSON.stringify({
        textQuery,
        pageSize: 20,
        locationRestriction: { rectangle: REGION },
        ...(pageToken ? { pageToken } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    const body = (await res.json().catch(() => null)) as {
      places?: Raw[];
      nextPageToken?: string;
      error?: { status?: string; details?: { reason?: string }[] };
    } | null;
    if (res.ok && body && !body.error)
      return {
        places: (body.places ?? []).flatMap((r) => toPlace(r) ?? []),
        next: body.nextPageToken ?? null,
      };
    // The day's quota won't come back in seconds: no retry for that.
    const daily = JSON.stringify(body?.error ?? "").includes("PerDay");
    const retry = (res.status === 429 && !daily) || res.status >= 500;
    if (!retry || i >= RETRIES)
      // The status word only: never the request (it carries the key).
      throw new PlacesError(
        `Places search failed (${res.status} ${body?.error?.status ?? ""}${daily ? ", daily quota" : ""})`.trim(),
        retry,
        // A refused key or request, or the day's quota: no retry helps today.
        daily || (res.status >= 400 && res.status < 500 && res.status !== 429),
      );
    await sleep(backoffMs * (i + 1));
  }
}

/** One query in one town, up to `pages` pages. */
export async function searchTown(
  query: string,
  town: string,
  pages: number,
  o: PlacesOpts,
): Promise<Place[]> {
  const out: Place[] = [];
  let token: string | null = null;
  for (let page = 0; page < pages; page++) {
    const got: { places: Place[]; next: string | null } = await searchPage(
      `${query} in ${town}, Oregon`,
      token,
      o,
    );
    out.push(...got.places);
    if (!got.next) break;
    token = got.next;
  }
  return out;
}

/**
 * Every place of a theme in the towns that have a vetted park,
 * deduplicated by place id. Any failure fails the whole search: the
 * caller tries again on its next run, or skips the week.
 */
export async function themePlaces(
  theme: MashupTheme,
  parks: readonly MashupPark[],
  month: number,
  o: PlacesOpts,
): Promise<Place[]> {
  const towns = [...new Set(parks.map((p) => p.city))];
  const byId = new Map<string, Place>();
  // The first query in every town (two pages in Bend); any other only in
  // Bend, where most places are: about 5 or 6 requests a theme.
  for (const [qi, query] of themeQueries(theme, month).entries())
    for (const town of qi === 0 ? towns : towns.filter((t) => t === "Bend"))
      for (const p of await searchTown(
        query,
        town,
        qi === 0 ? (PAGES[town] ?? 1) : 1,
        o,
      ))
        if (!byId.has(p.placeId)) byId.set(p.placeId, p);
  return [...byId.values()];
}
