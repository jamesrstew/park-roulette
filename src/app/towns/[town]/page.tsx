import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { CrayonLoading } from "@/components/Loading";
import { PageTitle } from "@/components/PageTitle";
import {
  CompareTable,
  Faq,
  nameList,
  type Qa,
  Section,
  SpinCta,
  TopRated,
  Updated,
} from "@/components/seo/Guide";
import { JsonLd } from "@/components/seo/JsonLd";
import { parkFacts } from "@/lib/park-facts";
import {
  FEATURE_PAGE_MIN,
  FEATURE_PAGES,
  hasOwnPage,
  hasPlay,
  longDate,
  newest,
  publicParks,
  topRated,
  townsOf,
} from "@/lib/seo-data";
import { SITE_URL } from "@/lib/site";

type Props = { params: Promise<{ town: string }> };

async function townFor(slug: string) {
  await connection(); // live data, never a build-time snapshot
  const towns = townsOf(await publicParks());
  const town = towns.find((t) => t.slug === slug);
  return town && hasOwnPage(town) ? { town, towns } : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { town: slug } = await params;
  const found = await townFor(slug);
  if (!found) return { title: "Lost town", robots: { index: false } };
  const { town } = found;
  const n = town.parks.filter(hasPlay).length;
  const title = `Playgrounds in ${town.name}, OR: ${n} parks with family tips`;
  const description = `Every playground in ${town.name}, OR, with splash pads, toddler areas, shade, restrooms and ratings from local families. Updated ${longDate(newest(town.parks)).replace(/ \d+,/, "")}.`;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: `/towns/${town.slug}` },
    openGraph: { title, description, type: "website" },
  };
}

async function Town({ params }: Props) {
  const { town: slug } = await params;
  const found = await townFor(slug);
  if (!found) notFound();
  const { town, towns } = found;
  const parks = [...town.parks].sort((a, b) => a.name.localeCompare(b.name));
  const play = parks.filter(hasPlay);
  const updated = newest(parks);
  const top = topRated(parks);
  const count = (pred: (p: (typeof parks)[number]) => boolean) =>
    parks.filter(pred);
  const features = FEATURE_PAGES.map((f) => ({ f, parks: count(f.matches) }));
  const headsUp = (key: string) => count((p) => parkFacts(p).has(key));
  const busy = headsUp("busy_road");
  const water = headsUp("open_water");
  const goats = headsUp("goatheads");
  const splash = features.find((x) => x.f.slug === "splash-pads")!.parks;
  const toddler = features.find((x) => x.f.slug === "toddler-friendly")!.parks;
  const shade = features.find((x) => x.f.slug === "shaded")!.parks;

  const lead = [
    `Park Roulette lists ${parks.length} parks in ${town.name}, Oregon: ${play.length} with a playground or nature play.`,
    splash.length
      ? `${splash.length} ${splash.length === 1 ? "has a splash pad" : "have splash pads"}, ${toddler.length} ${toddler.length === 1 ? "is" : "are"} toddler-friendly and ${shade.length} ${shade.length === 1 ? "has" : "have"} shade.`
      : `${toddler.length} ${toddler.length === 1 ? "is" : "are"} toddler-friendly and ${shade.length} ${shade.length === 1 ? "has" : "have"} shade.`,
    top.length
      ? `Top rated by local families: ${top
          .slice(0, 3)
          .map((p) => `${p.name} (${(p.avgTenths! / 10).toFixed(1)})`)
          .join(", ")}.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const faq: Qa[] = [
    {
      q: `How many playgrounds are in ${town.name}?`,
      a: `Park Roulette lists ${play.length} playgrounds and nature play areas in ${town.name}, plus ${parks.length - play.length} parks without a playground.`,
    },
    {
      q: `Which ${town.name} parks have a splash pad?`,
      a: splash.length
        ? `${nameList(splash)}.`
        : `None that families have reported yet. Know one? Add it on its park page.`,
    },
    {
      q: `Where can toddlers play in ${town.name}?`,
      a: toddler.length
        ? `Families point to ${nameList(toddler)} for toddler areas, baby swings or fences.`
        : "Families haven't flagged a toddler area yet.",
    },
    {
      q: `Which ${town.name} playgrounds have shade?`,
      a: shade.length
        ? `${nameList(shade)}.`
        : "Families haven't reported a shaded playground yet.",
    },
  ];

  const everywhere = towns.flatMap((t) => t.parks);
  const published = new Set(
    FEATURE_PAGES.filter(
      (f) => everywhere.filter(f.matches).length >= FEATURE_PAGE_MIN,
    ).map((f) => f.slug),
  );
  const others = towns.filter((t) => t.slug !== town.slug && hasOwnPage(t));
  const url = `${SITE_URL}/towns/${town.slug}`;

  return (
    <article className="flex flex-col gap-7">
      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            "@id": url,
            url,
            name: `Playgrounds in ${town.name}, Oregon`,
            description: lead,
            dateModified: updated,
            about: {
              "@type": "City",
              name: town.name,
              containedInPlace: { "@type": "State", name: "Oregon" },
            },
            mainEntity: {
              "@type": "ItemList",
              numberOfItems: parks.length,
              itemListElement: parks.map((p, i) => ({
                "@type": "ListItem",
                position: i + 1,
                url: `${SITE_URL}/parks/${p.slug}`,
                name: p.name,
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
                name: "Central Oregon",
                item: `${SITE_URL}/towns`,
              },
              { "@type": "ListItem", position: 3, name: town.name, item: url },
            ],
          },
        ]}
      />
      <PageTitle
        lead="Playgrounds in"
        accent={town.name}
        trail=", Oregon"
        color="green"
        underline="yellow"
        underlineWidth="w-48"
        size="text-4xl"
      />
      <p className="doodle-box bg-[color-mix(in_srgb,var(--color-crayon-yellow)_14%,#fffdf7)] p-4 leading-relaxed">
        {lead}
      </p>
      <Updated iso={updated} label={longDate(updated)} />

      {top.length > 0 && (
        <Section title="Top rated by families">
          <TopRated parks={top} />
        </Section>
      )}

      <Section title={`Every park in ${town.name}`}>
        <CompareTable parks={parks} caption={`Every park in ${town.name}`} />
      </Section>

      <Section title="Find one for your crew">
        <ul className="flex flex-col gap-2">
          {features
            .filter((x) => x.parks.length > 0)
            .map(({ f, parks: ps }) => (
              <li key={f.slug} className="leading-snug">
                <b className="font-hand text-xl font-normal">{f.title}:</b>{" "}
                {nameList(ps, 4)}.{" "}
                {published.has(f.slug) && (
                  <Link href={`/playgrounds/${f.slug}`} className="underline">
                    All {f.plural} in Central Oregon
                  </Link>
                )}
              </li>
            ))}
        </ul>
      </Section>

      {(busy.length > 0 || water.length > 0 || goats.length > 0) && (
        <Section title="Good to know">
          <ul className="flex flex-col gap-1.5 leading-snug">
            {busy.length > 0 && (
              <li>Close to a busy road: {nameList(busy, 6)}.</li>
            )}
            {water.length > 0 && (
              <li>Open water nearby (river or pond): {nameList(water, 6)}.</li>
            )}
            {goats.length > 0 && (
              <li>
                Goatheads (prickly burrs, wear shoes): {nameList(goats, 6)}.
              </li>
            )}
          </ul>
        </Section>
      )}

      <Section title="Questions parents ask">
        <Faq items={faq} />
      </Section>

      <SpinCta />

      <nav
        aria-label="More towns"
        className="text-center text-sm leading-relaxed"
      >
        More towns:{" "}
        {others.map((t, i) => (
          <span key={t.slug}>
            {i > 0 && " · "}
            <Link href={`/towns/${t.slug}`} className="underline">
              {t.name}
            </Link>
          </span>
        ))}
        {" · "}
        <Link href="/towns" className="underline">
          All of Central Oregon
        </Link>
      </nav>
      <p className="text-center text-xs leading-snug text-ink-soft">
        Park details come from public maps and from local families, and can
        change. Check when you get there.
      </p>
    </article>
  );
}

export default function TownPage(props: Props) {
  return (
    <Suspense fallback={<CrayonLoading label="Unfolding the town map…" />}>
      <Town {...props} />
    </Suspense>
  );
}
