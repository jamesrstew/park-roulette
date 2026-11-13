import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { CrayonLoading } from "@/components/Loading";
import { PageTitle } from "@/components/PageTitle";
import {
  CompareTable,
  nameList,
  Section,
  SpinCta,
  Updated,
} from "@/components/seo/Guide";
import { JsonLd } from "@/components/seo/JsonLd";
import {
  FEATURE_PAGE_MIN,
  FEATURE_PAGES,
  featurePage,
  longDate,
  newest,
  publicParks,
  townPageHref,
  townsOf,
} from "@/lib/seo-data";
import { SITE_URL } from "@/lib/site";
import { townSlug } from "@/lib/towns";

type Props = { params: Promise<{ feature: string }> };

async function load(slug: string) {
  await connection();
  const f = featurePage(slug);
  if (!f) return null;
  const all = await publicParks();
  const parks = all.filter(f.matches);
  if (parks.length < FEATURE_PAGE_MIN) return null;
  return { f, parks, all, towns: townsOf(all) };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const found = await load((await params).feature);
  if (!found) return { title: "Nothing here yet", robots: { index: false } };
  const { f, parks } = found;
  const title = `${f.title} in Central Oregon (${parks.length})`;
  const description = `All ${parks.length} ${f.plural} in Bend, Redmond and Central Oregon that families know about, with ratings and what else each one has. Updated ${longDate(newest(parks)).replace(/ \d+,/, "")}.`;
  return {
    title: { absolute: `${title} · Park Roulette` },
    description,
    alternates: { canonical: `/playgrounds/${f.slug}` },
    openGraph: { title, description, type: "website" },
  };
}

async function Feature({ params }: Props) {
  const found = await load((await params).feature);
  if (!found) notFound();
  const { f, parks, all, towns } = found;
  const updated = newest(parks);
  const byTown = towns
    .map((t) => ({
      t,
      parks: parks
        .filter((p) => townSlug(p.city) === t.slug)
        .sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .filter((x) => x.parks.length > 0);
  const lead = `Families on Park Roulette know of ${parks.length} ${f.plural} in Central Oregon: ${byTown
    .map((x) => `${x.parks.length} in ${x.t.name}`)
    .join(", ")}. ${f.blurb}`;
  const url = `${SITE_URL}/playgrounds/${f.slug}`;
  const more = FEATURE_PAGES.filter(
    (x) =>
      x.slug !== f.slug && all.filter(x.matches).length >= FEATURE_PAGE_MIN,
  );

  return (
    <article className="flex flex-col gap-7">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          "@id": url,
          url,
          name: `${f.title} in Central Oregon`,
          description: lead,
          dateModified: updated,
          mainEntity: {
            "@type": "ItemList",
            numberOfItems: parks.length,
            itemListElement: byTown
              .flatMap((x) => x.parks)
              .map((p, i) => ({
                "@type": "ListItem",
                position: i + 1,
                url: `${SITE_URL}/parks/${p.slug}`,
                name: p.name,
              })),
          },
        }}
      />
      <PageTitle
        accent={f.title}
        trail=" in Central Oregon"
        color="teal"
        underline="pink"
        underlineWidth="w-48"
        size="text-4xl"
      />
      <p className="doodle-box bg-[color-mix(in_srgb,var(--color-crayon-yellow)_14%,#fffdf7)] p-4 leading-relaxed">
        {lead}
      </p>
      <Updated iso={updated} label={longDate(updated)} />

      {byTown.map(({ t, parks: ps }) => (
        <Section key={t.slug} title={`${f.title} in ${t.name}`}>
          <p className="-mt-1 text-sm text-ink-soft">
            {nameList(ps)}.{" "}
            <Link href={townPageHref(t)} className="underline">
              Every park in {t.name}
            </Link>
          </p>
          <CompareTable parks={ps} caption={`${f.title} in ${t.name}`} />
        </Section>
      ))}

      <p className="text-sm leading-snug text-ink-soft">
        Families say which parks have what, and park fixes need two families to
        agree. Things change, so check when you get there. Know one we&apos;re
        missing? Mark it on its park page.
      </p>

      <SpinCta />

      <nav
        aria-label="More lists"
        className="text-center text-sm leading-relaxed"
      >
        More lists:{" "}
        {more.map((x, i) => (
          <span key={x.slug}>
            {i > 0 && " · "}
            <Link href={`/playgrounds/${x.slug}`} className="underline">
              {x.title}
            </Link>
          </span>
        ))}
        {" · "}
        <Link href="/towns" className="underline">
          By town
        </Link>
      </nav>
    </article>
  );
}

export default function FeaturePageRoute(props: Props) {
  return (
    <Suspense fallback={<CrayonLoading />}>
      <Feature {...props} />
    </Suspense>
  );
}
