/**
 * Build data/ig-handles.json: the Instagram handles we may tag, each one
 * proven both ways (lib/social/handles.ts). Run by hand, then review every
 * entry before committing:
 *
 *   NEWS_INGEST_TOKEN=... IG_ACCESS_TOKEN=... IG_USER_ID=... [IG_APP_SECRET=...] \
 *     pnpm exec tsx scripts/ig-handles.mts [--dry]
 *
 * Candidates: the organizer domains of the events in production (the
 * harvest's read-only GET /api/events/known?days=60), the park operators
 * (the official sites in data/parks.json), and the catalog's venues and
 * series (data/news-catalog.json). For each domain it fetches the
 * organizer's own page, its homepage and a contact or about page, plainly
 * and with our honest User-Agent (a bot wall means no handle, never a way
 * around it), reads the instagram.com links, and asks Business Discovery
 * whether each account names the same site. Nothing is guessed from names.
 * Tokens are read from the environment and never printed.
 *
 * Entries already in the registry are kept as they are unless the run
 * proves them again (so a site that's down today doesn't erase a proven
 * handle); --dry prints the table without writing.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { botWall } from "../src/lib/news/fetcher";
import { UA } from "../src/lib/news/ua";
import {
  businessDiscovery,
  type DiscoveredAccount,
} from "../src/lib/social/graph";
import {
  competitor,
  hostDomain,
  igLinksIn,
  LINK_IN_BIO,
  NEVER_TAG,
  type HandleEntry,
  type Registry,
  registrableDomain,
  siteDomain,
  verifyPair,
} from "../src/lib/social/handles";

const REGISTRY_FILE = "data/ig-handles.json";
const dry = process.argv.includes("--dry");

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Set ${k} in the environment.`);
  return v;
};
const graph = {
  token: env("IG_ACCESS_TOKEN"),
  igUserId: env("IG_USER_ID"),
  appSecret: process.env.IG_APP_SECRET || undefined,
};

/** Park operators: the official site a park's own page is on, and who runs it. */
const OPERATORS: Record<string, string> = {
  "bendparksandrec.org": "Bend Park & Recreation District",
  "redmondoregon.gov": "City of Redmond",
  "ccprd.org": "Crook County Parks & Recreation District",
  "lapineparks.org": "La Pine Park & Recreation District",
  "madras.gov": "City of Madras",
  "ci.madras.or.us": "City of Madras",
  "raprd.org": "Redmond Area Park & Recreation District",
  "sistersrecreation.com": "Sisters Park & Recreation District",
  "stateparks.oregon.gov": "Oregon State Parks",
};

type Candidate = {
  domain: string;
  org: string;
  pages: string[];
  why: string[];
};
const candidates = new Map<string, Candidate>();
function add(url: string, org: string, why: string) {
  const domain = siteDomain(url);
  if (!domain || competitor(domain, url)) return;
  const c = candidates.get(domain) ?? { domain, org, pages: [], why: [] };
  if (!c.pages.includes(url) && c.pages.length < 3) c.pages.push(url);
  if (!c.why.includes(why)) c.why.push(why);
  candidates.set(domain, c);
}

// 1. The events in production (read-only), by their named organizer's domain.
const known = (await (
  await fetch("https://parkroulette.quest/api/events/known?days=60", {
    headers: { authorization: `Bearer ${env("NEWS_INGEST_TOKEN")}` },
    signal: AbortSignal.timeout(60_000),
  })
).json()) as {
  events: {
    url: string;
    organizer?: { name: string; url: string };
    venue: { name: string };
  }[];
};
for (const e of known.events) {
  // The named organizer only: an event's own page may be a venue's or a
  // listing's, and never says who hosts it.
  if (!e.organizer || !hostDomain(e)) continue;
  add(e.organizer.url, e.organizer.name, "events");
}

// 2. Park operators: a park's official page on its operator's site.
const parks = JSON.parse(readFileSync("data/parks.json", "utf8")) as {
  slug: string;
  sources?: string[];
}[];
const parksBy = new Map<string, string[]>();
for (const p of parks)
  for (const s of p.sources ?? []) {
    const host = (() => {
      try {
        return new URL(s).hostname.replace(/^www\./, "");
      } catch {
        return "";
      }
    })();
    if (!OPERATORS[host]) continue;
    const d = registrableDomain(host);
    add(`https://${host}/`, OPERATORS[host], "parks");
    const list = parksBy.get(d) ?? [];
    if (!list.includes(p.slug)) list.push(p.slug);
    parksBy.set(d, list);
  }

// 3. The catalog's venues and series (the Unpack carousel's places).
const catalog = JSON.parse(readFileSync("data/news-catalog.json", "utf8")) as {
  venues: { name: string; url?: string }[];
  event_series: { name: string; url?: string }[];
};
for (const v of catalog.venues) if (v.url) add(v.url, v.name, "catalog venue");

// --- Fetching, plainly ---------------------------------------------------------

type Page = { url: string; status: number; html: string; wall: string | null };
async function getPage(url: string): Promise<Page> {
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent": UA,
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    const html = (await res.text()).slice(0, 3_000_000);
    // The harvest's own rule (lib/news/fetcher.ts): a 200 page is the
    // page unless it's a known challenge; anything else is reported.
    const wall =
      res.status === 200 &&
      !/sucuri_cloudproxy|cf-chl/i.test(html.slice(0, 4000))
        ? null
        : (botWall(res.status, res.headers.get("server") ?? "", html) ??
          (res.ok ? null : `HTTP ${res.status}`));
    return {
      url: res.url || url,
      status: res.status,
      html: res.ok ? html : "",
      wall,
    };
  } catch (e) {
    return {
      url,
      status: 0,
      html: "",
      wall: `unreachable (${(e as Error).name})`,
    };
  }
}

async function discover(handle: string): Promise<DiscoveredAccount | null> {
  try {
    return await businessDiscovery(handle, graph);
  } catch {
    return null;
  }
}

// --- The run --------------------------------------------------------------------

const today = new Date().toISOString().slice(0, 10);
const old = JSON.parse(readFileSync(REGISTRY_FILE, "utf8")) as Registry;
const entries: Record<string, HandleEntry> = {};
const rows: {
  domain: string;
  handle: string;
  followers: string;
  bio: string;
  forward: string;
  back: string;
}[] = [];
const none: { domain: string; org: string; why: string }[] = [];

for (const c of [...candidates.values()].sort((a, b) =>
  a.domain.localeCompare(b.domain),
)) {
  const home = `https://${c.domain}/`;
  const tries = [
    ...c.pages,
    home,
    `https://www.${c.domain}/`,
    `https://${c.domain}/contact`,
    `https://${c.domain}/contact-us`,
    `https://${c.domain}/about`,
  ].filter((u, i, a) => a.indexOf(u) === i);
  if (NEVER_TAG[c.domain]) {
    none.push({
      domain: c.domain,
      org: c.org,
      why: `never tagged: ${NEVER_TAG[c.domain]}`,
    });
    continue;
  }
  const linked: { handle: string; page: string }[] = [];
  const walls: string[] = [];
  let fetched = 0;
  let read = 0;
  for (const u of tries) {
    // The organizer's own pages first, then the homepage; contact and
    // about pages only when nothing has linked an account yet.
    if (linked.length && !c.pages.includes(u)) break;
    const p = await getPage(u);
    fetched++;
    if (p.wall) {
      walls.push(`${u}: ${p.wall}`);
      // A wall on the site: no way around it, and no more asking.
      if (!/^unreachable|^HTTP 404/.test(p.wall)) break;
      continue;
    }
    // A redirect off the organizer's site isn't its page.
    if (siteDomain(p.url) !== c.domain) continue;
    read++;
    for (const h of igLinksIn(p.html))
      if (!linked.some((l) => l.handle === h))
        linked.push({ handle: h, page: p.url });
  }
  if (!linked.length) {
    const kept = old.entries[c.domain];
    if (kept) entries[c.domain] = kept;
    none.push({
      domain: c.domain,
      org: c.org,
      why:
        read > 0
          ? `no instagram.com link on its pages (${read} of ${fetched} read)`
          : `the site blocked us or didn't answer (${walls.join("; ")})`,
    });
    continue;
  }
  const fails: string[] = [];
  let won: {
    handle: string;
    page: string;
    acct: DiscoveredAccount;
    back: string;
  } | null = null;
  for (const l of linked.slice(0, 5)) {
    const acct = await discover(l.handle);
    let linkPages: string[] = [];
    const site = siteDomain(acct?.website);
    if (acct?.website && site && LINK_IN_BIO.has(site)) {
      const lp = await getPage(acct.website);
      if (!lp.wall)
        linkPages = [...lp.html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map(
          (m) => m[1],
        );
    }
    const v = verifyPair({
      domain: c.domain,
      handle: l.handle,
      forwardHandles: linked.map((x) => x.handle),
      account: acct,
      linkPages,
    });
    if (v.ok && acct) {
      won = { handle: acct.username, page: l.page, acct, back: v.back };
      break;
    }
    fails.push(
      `@${l.handle}: ${(v as { why: string }).why}${acct ? ` (website ${acct.website ?? "none"})` : ""}`,
    );
  }
  if (!won) {
    none.push({ domain: c.domain, org: c.org, why: fails.join("; ") });
    continue;
  }
  entries[c.domain] = {
    handle: won.handle,
    igId: won.acct.id,
    org: c.org,
    name: won.acct.name,
    followers: won.acct.followers,
    forward: won.page,
    back: won.back,
    verifiedOn: today,
    ...(parksBy.get(c.domain)?.length
      ? { parks: parksBy.get(c.domain)!.sort() }
      : {}),
  };
  rows.push({
    domain: c.domain,
    handle: `@${won.handle}`,
    followers: String(won.acct.followers ?? "?"),
    bio: (won.acct.biography ?? "").replace(/\s+/g, " ").slice(0, 60),
    forward: won.page,
    back: won.back,
  });
}

console.log("\nVERIFIED (both directions)\n");
for (const r of rows)
  console.log(
    [
      r.domain,
      r.handle,
      r.followers,
      `"${r.bio}"`,
      `fwd ${r.forward}`,
      `back ${r.back}`,
    ].join(" | "),
  );
console.log("\nNO VERIFIED HANDLE\n");
for (const n of none) console.log(`${n.domain} (${n.org}): ${n.why}`);

if (!dry) {
  const sorted = Object.fromEntries(
    Object.entries(entries).sort(([a], [b]) => a.localeCompare(b)),
  );
  const out: Registry = {
    note: "Instagram handles proven both ways (the organization's site links the account; the account's website or bio names the site). Built by scripts/ig-handles.mts and reviewed by hand. Keyed by registrable domain. Never add a handle by hand.",
    entries: sorted,
  };
  writeFileSync(REGISTRY_FILE, `${JSON.stringify(out, null, 2)}\n`);
  console.log(
    `\nWrote ${Object.keys(sorted).length} entries to ${REGISTRY_FILE}.`,
  );
}
