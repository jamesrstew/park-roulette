import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Chip } from "@/components/events/EventBits";
import { Icon, type IconName } from "@/components/icons";
import { CrayonLoading } from "@/components/Loading";
import { PageTitle } from "@/components/PageTitle";
import { SpinCta } from "@/components/seo/Guide";
import { JsonLd } from "@/components/seo/JsonLd";
import { guidePath, guidesInOrder, type GuideSlug } from "@/lib/guides";
import { allGuides } from "@/lib/guides-data";
import { pairingGuidePath } from "@/lib/pairing-guides";
import { allPairingGuides } from "@/lib/pairing-guides-data";
import { pairingPagePath, PAIRINGS_HUB } from "@/lib/pairing-pages";
import { allPairingPages } from "@/lib/pairing-pages-data";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: { absolute: "Guides for Bend families · Park Roulette" },
  description:
    "Sledding hills, holiday events, indoor play, splash pads, and coffee shops, breweries and bakeries with a playground close by, in Bend and Central Oregon.",
  alternates: { canonical: "/guides" },
  openGraph: {
    title: "Guides for Bend families",
    description:
      "Sledding hills, holiday events, indoor play, splash pads, and places to go with a playground close by, in Bend and Central Oregon.",
    type: "website",
  },
};

const ICONS: Record<GuideSlug, IconName> = {
  "sledding-hills-bend": "mountains",
  "holiday-events-central-oregon": "sparkles",
  "indoor-play-bend": "home",
  "splash-pads-bend": "splash_pad",
};

const NOUN: Record<GuideSlug, [string, string]> = {
  "sledding-hills-bend": ["park", "parks"],
  "holiday-events-central-oregon": ["event", "events"],
  "indoor-play-bend": ["place", "places"],
  "splash-pads-bend": ["park", "parks"],
};

export default function GuidesPage() {
  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Breadcrumb" className="text-sm text-ink-soft">
        <Link href="/" className="underline">
          Park Roulette
        </Link>{" "}
        › Guides
      </nav>
      <PageTitle
        lead="Seasonal"
        accent="guides"
        color="orange"
        underline="blue"
        underlineWidth="w-40"
        subtitle={<p className="text-lg">What to do around Bend, by season.</p>}
      />
      <Suspense fallback={<CrayonLoading label="Finding the guides…" />}>
        <List />
        <Pairings />
      </Suspense>
      <SpinCta />
    </div>
  );
}

/** Park pairings guides: a place for you and a playground for them. */
async function Pairings() {
  await connection();
  const [views, pages] = await Promise.all([
    allPairingGuides(new Date()),
    allPairingPages(new Date()).catch(() => []),
  ]);
  if (!views.length && !pages.length) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-hand text-3xl leading-tight">Park pairings</h2>
      <p className="leading-snug">
        Somewhere for you, and a playground for the kids close by.
      </p>
      <ul className="flex flex-col gap-3">
        {views.map((v) => (
          <li key={v.def.slug}>
            <Link
              href={pairingGuidePath(v.def.slug)}
              className="doodle-box flex items-start gap-3 px-4 py-3"
            >
              <Icon
                name={v.def.rainy ? "home" : "playground"}
                size={44}
                className="mt-1 shrink-0"
              />
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="font-hand text-2xl leading-tight underline decoration-2 underline-offset-4">
                  {v.def.name}
                </span>
                <span className="leading-snug">{v.def.blurb}</span>
                <span className="flex flex-wrap gap-1.5">
                  <Chip>{v.pairs.length} pairs</Chip>
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {pages.length ? (
        <p className="flex flex-col gap-1 leading-snug">
          <span>From our posts, newest first:</span>
          {pages.slice(0, 3).map((v) => (
            <Link
              key={v.slug}
              href={pairingPagePath(v.slug)}
              className="flex min-h-11 items-center gap-2 underline"
            >
              <Icon name="star" size={22} className="shrink-0" />
              {v.name}
            </Link>
          ))}
          <Link
            href={PAIRINGS_HUB}
            className="flex min-h-11 items-center gap-2 font-hand text-xl underline"
          >
            Every park pairing <Icon name="arrow_right" size={22} />
          </Link>
        </p>
      ) : null}
    </section>
  );
}

async function List() {
  await connection();
  const now = new Date();
  const [views, pairings] = await Promise.all([
    allGuides(now).then(guidesInOrder),
    allPairingGuides(now),
  ]);
  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: "Seasonal guides for Bend families",
          url: `${SITE_URL}/guides`,
          inLanguage: "en-US",
          mainEntity: {
            "@type": "ItemList",
            itemListElement: [
              ...views.map((v) => ({
                name: v.title,
                url: `${SITE_URL}${guidePath(v.def.slug)}`,
              })),
              ...pairings.map((v) => ({
                name: v.title,
                url: `${SITE_URL}${pairingGuidePath(v.def.slug)}`,
              })),
            ].map((x, i) => ({ "@type": "ListItem", position: i + 1, ...x })),
          },
        }}
      />
      <ul className="flex flex-col gap-3">
        {views.map((v) => {
          const [one, many] = NOUN[v.def.slug];
          return (
            <li key={v.def.slug}>
              <Link
                href={guidePath(v.def.slug)}
                className="doodle-box flex items-start gap-3 px-4 py-3"
              >
                <Icon
                  name={ICONS[v.def.slug]}
                  size={44}
                  className="mt-1 shrink-0"
                />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="font-hand text-2xl leading-tight underline decoration-2 underline-offset-4">
                    {v.def.name}
                  </span>
                  <span className="leading-snug">{v.def.blurb}</span>
                  <span className="flex flex-wrap gap-1.5">
                    {v.inSeason ? (
                      <Chip tint="free">In season</Chip>
                    ) : (
                      <Chip>Season starts in {v.startsIn}</Chip>
                    )}
                    <Chip>
                      {v.count} {v.count === 1 ? one : many}
                    </Chip>
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
