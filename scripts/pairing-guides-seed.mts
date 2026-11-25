/**
 * Fill pairing_guides in a LOCAL database from a Places cache written by
 * scripts/anchor-samples.tsx (--cache), for screenshots and design review
 * without spending Places quota. Only the coffee pages can be filled this
 * way (the cache holds cafes); the others stay empty (no page).
 *
 *   DATABASE_URL=postgres://postgres@localhost:5544/<db> pnpm exec tsx \
 *     --conditions react-server scripts/pairing-guides-seed.mts <cache.json>
 */
import { readFileSync } from "node:fs";
import type { Place } from "../src/lib/social/mashup";

const url = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url))
  throw new Error("DATABASE_URL must be a local database.");
process.env.GOOGLE_PLACES_KEY ||= "local-cache-only";
const places = (
  JSON.parse(readFileSync(process.argv[2], "utf8")) as { v: Place[] }
).v;

/** Text Search's answer from the cache: cafes for coffee queries, else none. */
const stub = (async (_u: unknown, init?: RequestInit) => {
  const q = String(JSON.parse(String(init?.body ?? "{}")).textQuery ?? "");
  const hit = /^coffee/.test(q) ? places : [];
  return Response.json({
    places: hit.map((p) => ({
      id: p.placeId,
      displayName: { text: p.name },
      location: { latitude: p.lat, longitude: p.lng },
      addressComponents: p.town
        ? [{ shortText: p.town, types: ["locality"] }]
        : [],
      businessStatus: p.businessStatus,
      primaryType: p.primaryType,
      goodForChildren: p.goodForChildren,
      menuForChildren: p.menuForChildren,
      outdoorSeating: p.outdoorSeating,
      dineIn: p.dineIn,
      rating: p.rating,
      userRatingCount: p.userRatingCount,
      websiteUri: p.domain ? `https://${p.domain}/` : undefined,
    })),
  });
}) as unknown as typeof fetch;

const { refreshPairingGuides } = await import("../src/lib/pairing-guides-data");
console.log(
  await refreshPairingGuides(new Date(), { placesFetch: stub, max: 20 }),
);
process.exit(0);
