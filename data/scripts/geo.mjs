// Minimal geometry helpers for OSM Overpass "out geom" JSON (stdlib only).
const R = 6371000;
export function dist(a, b) {
  const toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR,
    dLon = (b.lon - a.lon) * toR;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
// Join way member geometries into closed rings by matching endpoints.
function assembleRings(parts) {
  const key = (p) => p.lat.toFixed(7) + "," + p.lon.toFixed(7);
  const rings = [];
  const pool = parts.filter((p) => p && p.length > 1).map((p) => p.slice());
  while (pool.length) {
    let ring = pool.shift();
    let guard = 0;
    while (key(ring[0]) !== key(ring[ring.length - 1]) && guard++ < 10000) {
      const endK = key(ring[ring.length - 1]);
      const i = pool.findIndex(
        (p) => key(p[0]) === endK || key(p[p.length - 1]) === endK,
      );
      if (i < 0) break;
      let nxt = pool.splice(i, 1)[0];
      if (key(nxt[0]) !== endK) nxt = nxt.reverse();
      ring = ring.concat(nxt.slice(1));
    }
    if (ring.length >= 4) rings.push(ring);
  }
  return rings;
}
// Returns {outer: [ring], inner: [ring]} or null for non-areas.
export function polygonOf(e) {
  if (e.type === "way" && e.geometry) {
    const g = e.geometry;
    if (
      g.length >= 4 &&
      g[0].lat === g[g.length - 1].lat &&
      g[0].lon === g[g.length - 1].lon
    )
      return { outer: [g], inner: [] };
    return null;
  }
  if (e.type === "relation" && e.members) {
    const outer = assembleRings(
      e.members
        .filter((m) => m.type === "way" && m.role !== "inner")
        .map((m) => m.geometry),
    );
    const inner = assembleRings(
      e.members
        .filter((m) => m.type === "way" && m.role === "inner")
        .map((m) => m.geometry),
    );
    return outer.length ? { outer, inner } : null;
  }
  return null;
}
function inRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (
      a.lat > pt.lat !== b.lat > pt.lat &&
      pt.lon < ((b.lon - a.lon) * (pt.lat - a.lat)) / (b.lat - a.lat) + a.lon
    )
      inside = !inside;
  }
  return inside;
}
export function inPoly(pt, poly) {
  if (!poly) return false;
  return (
    poly.outer.some((r) => inRing(pt, r)) &&
    !poly.inner.some((r) => inRing(pt, r))
  );
}
function segDist(p, a, b) {
  const kx = Math.cos((p.lat * Math.PI) / 180) * 111320,
    ky = 110540;
  const ax = (a.lon - p.lon) * kx,
    ay = (a.lat - p.lat) * ky,
    bx = (b.lon - p.lon) * kx,
    by = (b.lat - p.lat) * ky;
  const dx = bx - ax,
    dy = by - ay,
    L = dx * dx + dy * dy;
  let t = L ? -(ax * dx + ay * dy) / L : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(ax + t * dx, ay + t * dy);
}
// Distance from point to polygon (0 if inside).
export function distToPoly(pt, poly) {
  if (!poly) return Infinity;
  if (inPoly(pt, poly)) return 0;
  let d = Infinity;
  for (const r of poly.outer)
    for (let i = 1; i < r.length; i++)
      d = Math.min(d, segDist(pt, r[i - 1], r[i]));
  return d;
}
export function areaM2(poly) {
  if (!poly) return 0;
  let tot = 0;
  for (const r of poly.outer) {
    const lat0 = r[0].lat,
      kx = Math.cos((lat0 * Math.PI) / 180) * 111320,
      ky = 110540;
    let s = 0;
    for (let i = 1; i < r.length; i++)
      s +=
        r[i - 1].lon * kx * (r[i].lat * ky) -
        r[i].lon * kx * (r[i - 1].lat * ky);
    tot += Math.abs(s) / 2;
  }
  return tot;
}
export function centerOf(e) {
  if (e.type === "node") return { lat: e.lat, lon: e.lon };
  const poly = polygonOf(e);
  const pts = poly
    ? poly.outer.flat()
    : (e.geometry || (e.members || []).flatMap((m) => m.geometry || [])).filter(
        Boolean,
      );
  if (!pts.length)
    return e.bounds
      ? {
          lat: (e.bounds.minlat + e.bounds.maxlat) / 2,
          lon: (e.bounds.minlon + e.bounds.maxlon) / 2,
        }
      : null;
  // vertex mean (fine for small playground/park shapes)
  const uniq = pts.slice(
    0,
    poly && pts.length > 1 ? pts.length - 1 : pts.length,
  );
  return {
    lat: uniq.reduce((s, p) => s + p.lat, 0) / uniq.length,
    lon: uniq.reduce((s, p) => s + p.lon, 0) / uniq.length,
  };
}
