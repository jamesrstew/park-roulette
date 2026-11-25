import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { CrayonLoading } from "@/components/Loading";
import { PageTitle } from "@/components/PageTitle";
import { SignupStrip } from "@/components/social/SignupStrip";
import { SocialTracker } from "@/components/social/SocialTracker";
import { type GridTile, mediaSrc, withFrom } from "@/lib/social/links";
import { carryFrom } from "@/lib/social/sources";
import { socialGrid } from "@/lib/social/public";
import { NOINDEX } from "@/lib/site";

/**
 * The link in bio (parkroulette.quest/social; /ig redirects here): our
 * Instagram and Facebook posts, newest first. Tap the one you saw and go
 * where it points (the park, the issue, the week's events), or to its own
 * page when it has several places (lib/social/links.ts). The signup sits
 * on top, with the visit's source (?from=ig, ig_dm, fb).
 *
 * noindex: a page of thumbnails with no words of its own; the places it
 * links to are the pages worth finding.
 */

export const metadata: Metadata = {
  title: "Our posts: tap the one you saw",
  description:
    "Every Park Roulette post for Central Oregon families, newest first, with its park, events or ideas one tap away.",
  alternates: { canonical: "/social" },
  ...NOINDEX,
};

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function Strip({ searchParams }: Props) {
  const from = (await searchParams).from;
  return <SignupStrip from={from} />;
}

function Tile({
  t,
  eager,
  from,
}: {
  t: GridTile;
  eager: boolean;
  from: string | null;
}) {
  return (
    <li>
      <Link
        href={withFrom(t.href, from)}
        data-social={t.to}
        prefetch={false}
        className="group flex flex-col gap-1.5 rounded-xl focus-visible:outline-offset-2"
      >
        <span className="relative block aspect-[4/5] overflow-hidden rounded-xl border-2 border-ink bg-paper-dark shadow-[3px_4px_0_#2b2a33] transition-transform group-hover:-rotate-1 group-active:translate-x-0.5 group-active:translate-y-0.5 group-active:shadow-none">
          <Image
            src={mediaSrc(t.cover)}
            alt={t.cover.alt}
            width={t.cover.width}
            height={t.cover.height}
            sizes="(max-width: 640px) 50vw, 288px"
            loading={eager ? "eager" : "lazy"}
            fetchPriority={eager ? "high" : "auto"}
            className="h-full w-full object-cover"
          />
        </span>
        <span className="flex flex-col px-1 leading-tight">
          <span className="truncate font-hand text-xl">{t.label}</span>
          <span className="text-sm text-ink-soft">{t.when}</span>
        </span>
      </Link>
    </li>
  );
}

async function Grid({ searchParams }: Props) {
  // The visit's source rides on to where the tile leads, so a signup there
  // still counts for Instagram or Facebook.
  // searchParams first: it makes this request-time, so the build never
  // queries the database (CI has none, and the build failed on Nov 23).
  const from = carryFrom((await searchParams).from);
  const tiles = await socialGrid();
  // Empty (before the first post): the signup is the whole page.
  if (!tiles.length) return null;
  return (
    <SocialTracker source="social_grid">
      <section aria-labelledby="grid-h" className="flex flex-col gap-2">
        <h2 id="grid-h" className="sr-only">
          Our posts, newest first
        </h2>
        <ul className="grid grid-cols-2 gap-x-3 gap-y-4 sm:gap-x-4 sm:gap-y-5">
          {tiles.map((t, i) => (
            <Tile key={t.id} t={t} eager={i < 4} from={from} />
          ))}
        </ul>
      </section>
    </SocialTracker>
  );
}

export default function SocialPage({ searchParams }: Props) {
  return (
    <div className="flex flex-col gap-5 pb-32">
      <PageTitle
        lead="From our"
        accent="posts"
        color="orange"
        underline="blue"
        underlineWidth="w-40"
        size="text-4xl"
        subtitle={<p>Saw one on Instagram? Tap it below.</p>}
      />
      <Suspense fallback={<div className="h-[9.5rem]" aria-hidden />}>
        <Strip searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={<CrayonLoading label="One sec…" />}>
        <Grid searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
