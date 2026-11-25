import { z } from "zod";
import raw from "../../../data/indoor-places.json";

/**
 * Indoor anchors for the park pairings (data/indoor-places.json, built by
 * scripts/indoor-places.mts and reviewed by hand): family places that need
 * no event, where kids 0 to 10 can play indoors. Library branches, play
 * gyms, a pool with kids' swims.
 *
 * Every entry is our data: the name and line come from the place's own
 * site, the line is grounded by a verbatim quote from that site (re-checked
 * when the file is rebuilt), and the point comes from OpenStreetMap
 * (Nominatim) for the address on that site. Of Google's, only the place id
 * is kept (Google lets us keep ids), to read opening hours at make time.
 */

export const INDOOR_TYPES = ["library", "play_gym", "museum", "pool"] as const;
export type IndoorType = (typeof INDOOR_TYPES)[number];

/** The slide's label over the anchor's line. */
export const INDOOR_LABEL: Record<IndoorType, string> = {
  library: "At the library",
  play_gym: "At the play gym",
  museum: "At the museum",
  pool: "At the pool",
};

const Https = z.url({ protocol: /^https$/ });

export const IndoorPlace = z.strictObject({
  /** Our slug ("central-library-bend"). */
  slug: z.string().regex(/^[a-z0-9-]+$/),
  /** The name as the place's own site has it. */
  name: z.string().trim().min(3).max(60),
  town: z.string().trim().min(3).max(30),
  type: z.enum(INDOOR_TYPES),
  /** Google's place id (an id only), for hours at make time. */
  place_id: z.string().min(10).max(300),
  /** The place's own site (registrable domain) and its page. */
  site: z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/),
  url: Https,
  /** What kids do there, our words, 60 characters at most. */
  line: z.string().trim().min(10).max(60),
  /** The place's own page(s), quoted verbatim, grounding the line. */
  evidence: z
    .array(z.strictObject({ url: Https, quote: z.string().min(12).max(300) }))
    .min(1)
    .max(3),
  /** OpenStreetMap's point for the address on the place's own site. */
  lat: z.number().min(43).max(45.2),
  lng: z.number().min(-122.5).max(-120),
  address: z.string().min(8).max(120),
  verified_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type IndoorPlace = z.infer<typeof IndoorPlace>;

const parsed = z.array(IndoorPlace).safeParse(raw);
/** The registry; empty (no indoor anchors) if the file doesn't parse. */
export const INDOOR: readonly IndoorPlace[] = parsed.success ? parsed.data : [];
export const INDOOR_ERROR = parsed.success
  ? null
  : parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
