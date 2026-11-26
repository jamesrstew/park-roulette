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
import { pairingGuidePath } from "@/lib/pairing-guides";
import { allPairingGuides } from "@/lib/pairing-guides-data";
import {
  pairingPagePath,
  PAIRINGS_HUB,
  type PairingPageView,
  townsPhrase,
} from "@/lib/pairing-pages";
import { allPairingPages } from "@/lib/pairing-pages-data";
import type { MashupTheme } from "@/lib/social/model";
import { SITE_URL } from "@/lib/site";

const DESCRIPTION =
  "Coffee, food trucks, bakeries and breweries, each paired with a playground or an indoor play spot close by, around Bend and Central Oregon. A new set every other week, newest first.";

export async function generateMetadata(): Promise<Metadata> {
  await connection();
  // An empty hub is no page to find: it waits for its first pairing page.
  const any = (await allPairingPages(new Date()).catch(() => [])).length > 0;
  return {
    title: {
      absolute:
        "Coffee, treats and food trucks near playgrounds in Bend, Oregon",
    },
    description: DESCRIPTION,
    alternates: { canonical: PAIRINGS_HUB },
    ...(any ? {} : { robots: { index: false } }),
    openGraph: {
      title: "Coffee, treats and food trucks near playgrounds in Bend, Oregon",
      description: DESCRIPTION,
      type: "website",
    },
  };
}

const ICON: Record<MashupTheme, IconName> = {
  coffee: "cup",
  food_trucks: "food_truck",
  breweries: "picnic",
  treats: "cupcake",
};

export default function PairingsHub() {
  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Breadcrumb" className="text-sm text-ink-soft">
        <Link href="/" className="underline">
          Park Roulette
        </Link>{" "}
        ›{" "}
        <Link href="/guides" className="underline">
          Guides
        </Link>{" "}
        › Park pairings
      </nav>
      <PageTitle
        lead="Park"
        accent="pairings"
        color="orange"
        underline="blue"
        underlineWidth="w-40"
        subtitle={
          <p className="text-lg">
            A stop for you, and somewhere fun for the kids close by. A new set
            every other week.
          </p>
        }
      />
      <Suspense fallback={<CrayonLoading label="Finding the pairings…" />}>
        <List />
      </Suspense>
      <SpinCta />
    </div>
  );
}

async function List() {
  await connection();
  const now = new Date();
  const [pages, guides] = await Promise.all([
    allPairingPages(now).catch(() => []),
    allPairingGuides(now),
  ]);
  return (
    <>
      {pages.length ? (
        <>
          <JsonLd
            data={[
              {
                "@context": "https://schema.org",
                "@type": "CollectionPage",
                "@id": `${SITE_URL}${PAIRINGS_HUB}`,
                name: "Park pairings",
                description: DESCRIPTION,
                url: `${SITE_URL}${PAIRINGS_HUB}`,
                inLanguage: "en-US",
                mainEntity: {
                  "@type": "ItemList",
                  itemListOrder: "https://schema.org/ItemListOrderDescending",
                  numberOfItems: pages.length,
                  itemListElement: pages.map((v, i) => ({
                    "@type": "ListItem",
                    position: i + 1,
                    name: v.title,
                    url: `${SITE_URL}${pairingPagePath(v.slug)}`,
                  })),
                },
              },
              {
                "@context": "https://schema.org",
                "@type": "BreadcrumbList",
                itemListElement: [
                  {
                    "@type": "ListItem",
                    position: 1,
                    name: "Park Roulette",
                    item: SITE_URL,
                  },
                  {
                    "@type": "ListItem",
                    position: 2,
                    name: "Guides",
                    item: `${SITE_URL}/guides`,
                  },
                  {
                    "@type": "ListItem",
                    position: 3,
                    name: "Park pairings",
                    item: `${SITE_URL}${PAIRINGS_HUB}`,
                  },
                ],
              },
            ]}
          />
          <ul className="flex flex-col gap-3">
            {pages.map((v) => (
              <Card key={v.slug} v={v} />
            ))}
          </ul>
        </>
      ) : (
        <div className="doodle-box flex flex-col items-center gap-3 px-4 py-6 text-center">
          <Icon name="cup" size={48} />
          <p className="font-hand text-2xl">
            The first set of pairings is on its way.
          </p>
          <Link
            href="/guides"
            className="crayon-btn wax min-h-12 bg-crayon-yellow px-5 text-xl"
          >
            See our guides
          </Link>
        </div>
      )}
      {guides.length ? (
        <section className="flex flex-col gap-3">
          <h2 className="font-hand text-3xl leading-tight">By town</h2>
          <p className="leading-snug">More pairs, town by town.</p>
          <ul className="flex flex-col gap-1">
            {guides.map((g) => (
              <li key={g.def.slug}>
                <Link
                  href={pairingGuidePath(g.def.slug)}
                  className="flex min-h-11 items-center gap-2 underline"
                >
                  <Icon
                    name={g.def.rainy ? "home" : ICON[g.def.theme]}
                    size={22}
                    className="shrink-0"
                  />
                  {g.def.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function Card({ v }: { v: PairingPageView }) {
  return (
    <li>
      <Link
        href={pairingPagePath(v.slug)}
        className="doodle-box flex items-start gap-3 px-4 py-3"
      >
        <Icon name={ICON[v.theme]} size={44} className="mt-1 shrink-0" />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="font-hand text-2xl leading-tight underline decoration-2 underline-offset-4">
            {v.name}
          </span>
          <span className="leading-snug">
            {v.pairs.map((p) => p.place).join(", ")}.
          </span>
          <span className="flex flex-wrap gap-1.5">
            <Chip>{townsPhrase(v.towns)}</Chip>
            <Chip>
              {v.pairs.length} pairs ·{" "}
              <time dateTime={v.bornDay}>{v.bornShort}</time>
            </Chip>
          </span>
        </span>
      </Link>
    </li>
  );
}
