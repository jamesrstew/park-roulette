/**
 * Render the Monday growth digest from a real database, READ-ONLY, without
 * storing or sending anything. Every week (the one asked for and the 4
 * before it) is gathered fresh; earlier weeks as a backfill would be.
 * The database session is opened read-only, so a bug here can't write.
 *
 *   DATABASE_URL=<url> pnpm exec tsx --conditions react-server \
 *     scripts/growth-preview.mts <out.html> [<a Monday, YYYY-MM-DD>]
 *
 * Instagram and Vercel numbers are read when IG_ACCESS_TOKEN / IG_USER_ID
 * and VERCEL_ANALYTICS_TOKEN / VERCEL_ANALYTICS_TEAM_ID are set. The
 * sitemap count comes from the live site's /sitemap.xml.
 */
import { writeFile } from "node:fs/promises";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Set DATABASE_URL on the command line.");
const ro = new URL(url);
ro.searchParams.set("default_transaction_read_only", "on");
process.env.DATABASE_URL = ro.toString();

const out = process.argv[2];
if (!out) throw new Error("Give an output file.");
const asked = process.argv[3];

const { collectWeek } = await import("../src/lib/growth/collect");
const { buildView } = await import("../src/lib/growth/analyze");
const { renderHtml, renderSubject, renderText } =
  await import("../src/lib/growth/render");
const { isMonday, lastFullWeek, weekOf, weeksBefore } =
  await import("../src/lib/growth/week");
const { webUrl, HISTORY_WEEKS } = await import("../src/lib/growth/digest");
const { db } = await import("../src/db");
const { kidEvents } = await import("../src/db/schema");
const { toRow, listed } = await import("../src/lib/events/store");
const { SITE_URL } = await import("../src/lib/site");

const week =
  asked && isMonday(asked) ? weekOf(asked) : lastFullWeek(new Date());
const live = {
  sitemap: async () => {
    const xml = await (await fetch(`${SITE_URL}/sitemap.xml`)).text();
    return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => ({
      url: m[1],
    }));
  },
  eventsListed: async () => {
    const now = new Date();
    const rows = await db.select().from(kidEvents);
    return rows.map(toRow).filter((e) => listed(e, now)).length;
  },
};

const history = [];
for (const w of weeksBefore(week, HISTORY_WEEKS))
  history.push(await collectWeek(w, { live: false }));
const cur = await collectWeek(week, { live: true, ...live });
const view = buildView(cur, history);
const o = { webUrl: webUrl(week.start) };
await writeFile(out, renderHtml(view, o));
await writeFile(out.replace(/\.html$/, ".txt"), renderText(view, o));
await writeFile(
  out.replace(/\.html$/, ".json"),
  JSON.stringify({ subject: renderSubject(view), cur, history }, null, 2),
);
console.log(renderSubject(view));
process.exit(0);
