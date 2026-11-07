// Scrape Bend Park & Recreation District park pages (from its Yoast park sitemap) for name, address,
// map pin, size, and the "Features" amenity list. Polite: 1 request/sec.
// Usage: node scripts/02-fetch-bprd.mjs   (writes raw/bprd.json)
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const UA = "Mozilla/5.0 (park-roulette-seed/0.1; family hobby project)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (u) => {
  const r = await fetch(u, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(u + " " + r.status);
  return r.text();
};
const decode = (s) =>
  s
    .replace(/&#8217;/g, "’")
    .replace(/&#8211;/g, "–")
    .replace(/&amp;/g, "&")
    .replace(/&#038;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"');
const textLines = (html) =>
  decode(
    html
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "")
      .replace(/<[^>]+>/g, "\n"),
  )
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
const sitemap = await get("https://www.bendparksandrec.org/park-sitemap.xml");
const urls = [...sitemap.matchAll(/<loc>([^<]+\/park\/[^<]+)<\/loc>/g)].map(
  (m) => m[1],
);
const out = [];
for (const url of urls) {
  try {
    const html = await get(url);
    const title = decode((html.match(/<title>([^<]*)/) || [])[1] || "")
      .replace(/\s*-\s*Bend Park and Recreation District\s*$/, "")
      .trim();
    const lat = parseFloat((html.match(/data-lat="(-?[0-9.]+)"/) || [])[1]);
    const lng = parseFloat((html.match(/data-lng="(-?[0-9.]+)"/) || [])[1]);
    const L = textLines(html);
    const ai = L.indexOf("Address");
    const address = ai >= 0 ? L[ai + 1] : null;
    const si = L.indexOf("Size");
    const size = si >= 0 ? L[si + 1] : null;
    const fEnd = L.findIndex((l) =>
      l.startsWith("Trail, park or property information"),
    );
    let fStart = -1;
    for (let i = fEnd; i >= 0; i--)
      if (L[i] === "Features") {
        fStart = i;
        break;
      }
    const features =
      fStart >= 0 && fEnd > fStart ? L.slice(fStart + 1, fEnd) : [];
    // description: text between the second occurrence of the title/address header and "Hours"
    const hi = L.indexOf("Hours");
    const di = L.findIndex((l, i) => i > 0 && L[i - 1] === "Directions");
    const description =
      di >= 0 && hi > di ? L.slice(di, hi).join(" ").slice(0, 1500) : "";
    out.push({
      url,
      name: title,
      address,
      lat: isNaN(lat) ? null : lat,
      lng: isNaN(lng) ? null : lng,
      size,
      features,
      description,
    });
    console.log(title, "|", features.filter((f) => /play/i.test(f)).join(","));
  } catch (e) {
    console.error("ERR", url, e.message);
    out.push({ url, error: e.message });
  }
  await sleep(1000);
}
writeFileSync(
  join(here, "..", "raw", "bprd.json"),
  JSON.stringify(out, null, 1),
);
console.log("parks", out.length);
