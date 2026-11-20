import { connection } from "next/server";
import { parkFacts } from "@/lib/park-facts";
import {
  FEATURE_PAGE_MIN,
  FEATURE_PAGES,
  hasOwnPage,
  longDate,
  newest,
  publicParks,
  townsOf,
} from "@/lib/seo-data";
import { SITE_URL } from "@/lib/site";

/**
 * /llms.txt (llmstxt.org): a plain Markdown map of the site for AI
 * assistants, with one factual line per park. Public data only.
 */
export async function GET() {
  await connection();
  const parks = await publicParks();
  const towns = townsOf(parks);
  const features = FEATURE_PAGES.filter(
    (f) => parks.filter(f.matches).length >= FEATURE_PAGE_MIN,
  );
  const lines = [
    "# Park Roulette",
    "",
    `> A free game and guide for families visiting playgrounds in Central Oregon (Bend, Redmond, Prineville, Sisters and nearby towns). ${parks.length} parks, with features and star ratings from local families. Updated ${longDate(newest(parks))}.`,
    "",
    "Star ratings are 0 to 5, to the tenth, from families who visited. Features come from public maps and from families; changes need two families to agree.",
    "",
    "## Towns",
    "",
    ...towns
      .filter(hasOwnPage)
      .map(
        (t) =>
          `- [Playgrounds in ${t.name}, Oregon](${SITE_URL}/towns/${t.slug}): ${t.parks.length} parks`,
      ),
    `- [All of Central Oregon](${SITE_URL}/towns): every town, including smaller ones`,
    "",
    "## Lists",
    "",
    ...features.map(
      (f) =>
        `- [${f.title} in Central Oregon](${SITE_URL}/playgrounds/${f.slug}): ${f.blurb}`,
    ),
    "",
    "## Parks",
    "",
    ...[...parks]
      .sort(
        (a, b) => a.city.localeCompare(b.city) || a.name.localeCompare(b.name),
      )
      .map(
        (p) =>
          `- [${p.name}](${SITE_URL}/parks/${p.slug}): ${parkFacts(p).summary}`,
      ),
    "",
    "## Bend Playground Passport",
    "",
    `- [Kids' events](${SITE_URL}/events): upcoming kid-friendly events in Bend, Redmond, Sisters and beyond, each linked to its official page, with indoor picks, age tags and playgrounds nearby.`,
    `- [Bend Playground Passport](${SITE_URL}/newsletter): a free email every Thursday morning with the weekend forecast, one playground to try, an indoor backup and park closures. Past issues are on the page.`,
    `- [Weekend Pick](${SITE_URL}/texts): one playground for the weekend, texted on Fridays (US numbers).`,
    "",
    "## About",
    "",
    `- [Privacy Policy](${SITE_URL}/privacy)`,
    `- [Terms of Service](${SITE_URL}/terms)`,
    "- Contact: hello@parkroulette.quest",
    "",
  ];
  return new Response(lines.join("\n"), {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
