export type LatLng = { lat: number; lng: number };

/** Great-circle distance in miles. */
export function milesBetween(a: LatLng, b: LatLng): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function formatMiles(mi: number): string {
  if (mi < 0.2) return "right here!";
  if (mi < 10) return `${mi.toFixed(1)} mi`;
  return `${Math.round(mi)} mi`;
}

/** Opens turn-by-turn directions in Google Maps (app on phones, web elsewhere). */
export function directionsUrl(p: LatLng & { name: string }): string {
  const q = new URLSearchParams({
    api: "1",
    destination: `${p.lat},${p.lng}`,
    travelmode: "driving",
  });
  return `https://www.google.com/maps/dir/?${q}`;
}

/** Opens the place in Google Maps so you can peek at photos and reviews. */
export function placeUrl(p: LatLng & { name: string; city: string }): string {
  const q = new URLSearchParams({
    api: "1",
    query: `${p.name}, ${p.city}, OR`,
  });
  return `https://www.google.com/maps/search/?${q}`;
}

/**
 * Google Maps for a business by its place id (Maps URLs, api=1). The
 * "q=place_id:..." form opens nothing in the Maps app (Nov 26), so: a
 * search whose query is the name (and town), pinned by query_place_id,
 * which Maps opens directly and falls back to the query if it can't.
 */
export function mapsPlaceUrl(name: string, placeId: string, town?: string) {
  const q = new URLSearchParams({
    api: "1",
    query: [name, town, town ? "OR" : "Oregon"].filter(Boolean).join(", "),
    query_place_id: placeId,
  });
  return `https://www.google.com/maps/search/?${q}`;
}
