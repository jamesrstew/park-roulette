import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { CrayonLoading } from "@/components/Loading";
import { PageTitle } from "@/components/PageTitle";
import {
  CompareTable,
  Section,
  SpinCta,
  TopRated,
  Updated,
} from "@/components/seo/Guide";
import { JsonLd } from "@/components/seo/JsonLd";
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

export const metadata: Metadata = {
  title: {
    absolute: "Playgrounds in Central Oregon, town by town · Park Roulette",
  },
  description:
    "Every playground and park in Bend, Redmond, Prineville, Sisters, Sunriver, La Pine, Madras and nearby, with splash pads, toddler areas, shade and family ratings.",
  alternates: { canonical: "/towns" },
};

/** Central Oregon, town by town. Small towns are listed in full here. */
async function Hub() {
  await connection();
  const parks = await publicParks();
  const towns = townsOf(parks);
  const updated = newest(parks);
  const play = parks.filter(hasPlay).length;
  const top = topRated(parks);
  const features = FEATURE_PAGES.map((f) => ({
    f,
    n: parks.filter(f.matches).length,
  })).filter((x) => x.n >= FEATURE_PAGE_MIN);
  const big = towns.filter(hasOwnPage);
  const small = towns.filter((t) => !hasOwnPage(t));
  const lead = `Park Roulette lists ${parks.length} parks across ${towns.length} Central Oregon towns, ${play} of them with a playground or nature play. ${big
    .map((t) => `${t.name} has ${t.parks.length}`)
    .join(", ")}.`;

  return (
    <article className="flex flex-col gap-7">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          "@id": `${SITE_URL}/towns`,
          url: `${SITE_URL}/towns`,
          name: "Playgrounds in Central Oregon",
          description: lead,
          dateModified: updated,
          hasPart: towns.filter(hasOwnPage).map((t) => ({
            "@type": "CollectionPage",
            name: `Playgrounds in ${t.name}, Oregon`,
            url: `${SITE_URL}/towns/${t.slug}`,
          })),
        }}
      />
      <PageTitle
        lead="Playgrounds in"
        accent="Central Oregon"
        color="blue"
        underline="yellow"
        underlineWidth="w-56"
        size="text-4xl"
      />
      <p className="doodle-box bg-[color-mix(in_srgb,var(--color-crayon-yellow)_14%,#fffdf7)] p-4 leading-relaxed">
        {lead}
      </p>
      <Updated iso={updated} label={longDate(updated)} />

      <Section title="Pick a town">
        <ul className="grid grid-cols-2 gap-3">
          {big.map((t) => (
            <li key={t.slug}>
              <Link
                href={`/towns/${t.slug}`}
                className="doodle-box flex flex-col px-3 py-2.5"
              >
                <span className="font-hand text-2xl">{t.name}</span>
                <span className="text-sm text-ink-soft">
                  {t.parks.length} parks
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      {features.length > 0 && (
        <Section title="Looking for something?">
          <ul className="flex flex-wrap gap-2">
            {features.map(({ f, n }) => (
              <li key={f.slug}>
                <Link href={`/playgrounds/${f.slug}`} className="chip min-h-11">
                  {f.title} ({n})
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {top.length > 0 && (
        <Section title="Top rated by families">
          <TopRated parks={top} />
        </Section>
      )}

      {small.map((t) => (
        <Section key={t.slug} id={t.slug} title={`Parks in ${t.name}`}>
          <CompareTable
            caption={`Parks in ${t.name}`}
            parks={[...t.parks].sort((a, b) => a.name.localeCompare(b.name))}
          />
        </Section>
      ))}

      <SpinCta />
    </article>
  );
}

export default function TownsPage() {
  return (
    <Suspense fallback={<CrayonLoading label="Unfolding the map…" />}>
      <Hub />
    </Suspense>
  );
}
