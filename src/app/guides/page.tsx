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
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: { absolute: "Seasonal guides for Bend families · Park Roulette" },
  description:
    "Sledding hills, holiday events, indoor play and splash pads in Bend and Central Oregon, built from our park and event lists and kept up to date.",
  alternates: { canonical: "/guides" },
  openGraph: {
    title: "Seasonal guides for Bend families",
    description:
      "Sledding hills, holiday events, indoor play and splash pads in Bend and Central Oregon.",
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
      </Suspense>
      <SpinCta />
    </div>
  );
}

async function List() {
  await connection();
  const views = guidesInOrder(await allGuides(new Date()));
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
            itemListElement: views.map((v, i) => ({
              "@type": "ListItem",
              position: i + 1,
              name: v.title,
              url: `${SITE_URL}${guidePath(v.def.slug)}`,
            })),
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
