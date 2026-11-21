import { connection } from "next/server";
import type { Metadata } from "next";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { IssueCard } from "@/components/news/IssueCard";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Icon } from "@/components/icons";
import { CrayonLoading } from "@/components/Loading";
import { EmailSignup } from "@/components/ParkNews";
import { JsonLd } from "@/components/seo/JsonLd";
import { TextTapBeacon } from "@/components/news/TextTapBeacon";
import { TextsLink } from "@/components/news/TextsLink";
import { db } from "@/db";
import { parks as parksTable } from "@/db/schema";
import { getMe } from "@/lib/data";
import { directionsUrl } from "@/lib/geo";
import { CATALOG } from "@/lib/news/catalog";
import { loadParks, sentIssue, sentIssues } from "@/lib/news/data";
import type { Issue } from "@/lib/news/issue";
import { indoorVenue, indoorWeek, planTiers } from "@/lib/news/issue-preview";
import { subscriptionFor } from "@/lib/news/subscribers";
import {
  forecastWords,
  hasWeatherCard,
  NEWS_NAME,
  type RenderOptions,
  weatherImageSize,
  weatherImageUrl,
} from "@/lib/news/template";
import { addDays, isIsoDate, pacific, weekendOf } from "@/lib/news/time";
import { PARK_NEWS } from "@/lib/park-news";
import { SITE_URL } from "@/lib/site";
import { textsOn } from "@/lib/texts-store";
import { TEXTS_FROM } from "@/lib/texts";
import { townHref } from "@/lib/towns";
import { betterDay, roughTier } from "@/lib/weekend-pick";

type Props = {
  params: Promise<{ date: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** The kicker: what this is, for a parent who tapped a text or a forward. */
const KICKER = `${NEWS_NAME}, from Park Roulette: a free weekend plan for Central Oregon families, every Thursday`;

/** "Nov 20 to 22" (or "Nov 29 to Dec 1"). */
function weekendRange(date: string): string {
  const w = weekendOf(date);
  const fmt = (d: string, o: Intl.DateTimeFormatOptions) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", {
      timeZone: "UTC",
      ...o,
    });
  const sameMonth = w.from.slice(0, 7) === w.to.slice(0, 7);
  return `${fmt(w.from, { month: "short", day: "numeric" })} to ${fmt(w.to, sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" })}`;
}

const shortDate = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });

export async function generateMetadata({
  params,
}: Pick<Props, "params">): Promise<Metadata> {
  const { date } = await params;
  const sent = isIsoDate(date) ? await sentIssue(date) : null;
  if (!sent) return { title: "Lost issue", robots: { index: false } };
  const { issue } = sent;
  const url = `${SITE_URL}/newsletter/${date}`;
  const pick = (await loadParks()).find(
    (p) => p.slug === issue.wheel_pick.park,
  );
  const indoor = indoorWeek(issue, sent.plan);
  const days = issue.weekend_ahead?.days;
  // The picture's words: the forecast and the plan.
  const alt = [
    indoor ? `Indoor pick: ${indoor.name}.` : pick ? `${pick.name}.` : "",
    days ? forecastWords(days) : "",
  ]
    .filter(Boolean)
    .join(" ");
  const image = {
    url: `${url}/preview.jpg`,
    width: 1200,
    height: 630,
    alt,
    type: "image/jpeg",
  };
  return {
    metadataBase: new URL(SITE_URL),
    title: {
      absolute: `${issue.subject}, ${weekendRange(date)} | ${NEWS_NAME}`,
    },
    description: issue.preview,
    alternates: { canonical: `/newsletter/${date}` },
    openGraph: {
      type: "article",
      url,
      siteName: "Park Roulette",
      title: issue.subject,
      description: issue.preview,
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title: issue.subject,
      description: issue.preview,
      images: [image],
    },
  };
}

/**
 * The signup, for anyone this account doesn't show as subscribed (decided
 * by subscription, never ?src: forwards carry it). Thin on purpose: the
 * smart-footer branch owns the one-tap texts card and the browser cookie.
 */
async function Signup({ fromText }: { fromText: boolean }) {
  const me = await getMe();
  if (me?.isKid) return null;
  const emailOn = !!me && (await subscriptionFor(me.id)).status === "on";
  const textOn = !!me?.phone && (await textsOn(me.phone));
  const offerText = !textOn && !!TEXTS_FROM;
  if (emailOn && !offerText) return null;
  const source = fromText ? "issue_text" : "issue_page";
  return (
    <section
      aria-labelledby="issue-signup-h"
      className="doodle-box-alt flex flex-col gap-2 px-4 py-3"
    >
      <h2 id="issue-signup-h" className="font-hand text-2xl leading-tight">
        {emailOn ? "Want it by text too?" : "Get next weekend's plan Thursday"}
      </h2>
      {emailOn ? null : (
        <EmailSignup source={source} fine={PARK_NEWS.fineFull} />
      )}
      {offerText ? (
        <TextsLink lead="Or by text, Fridays:" from={source} />
      ) : null}
    </section>
  );
}

/** "Go Saturday: {Park}" or the Indoor pick, with one-tap Directions. */
async function ThePlan({
  issue,
  tiers,
  indoor,
  pick,
  goDay,
}: {
  issue: Issue;
  tiers: ReturnType<typeof planTiers>;
  indoor: ReturnType<typeof indoorWeek>;
  pick: { name: string; city: string } | undefined;
  /** The day Friday's update chose, when it changed the plan. */
  goDay?: string;
}) {
  const btn =
    "crayon-btn wax flex min-h-12 items-center gap-2 px-4 text-xl text-white [text-shadow:1px_1px_0_#2b2a33]";
  if (indoor) {
    const pb = issue.plan_b;
    const venue = CATALOG.venues.find((v) => v.id === pb?.venue_id);
    const where = venue?.address ?? `${indoor.name}, ${indoor.city}, OR`;
    return (
      <section aria-labelledby="plan-h" className="flex flex-col gap-2">
        <h2 id="plan-h" className="font-hand text-3xl leading-tight">
          Indoor pick:{" "}
          <a href={indoor.url} className="underline underline-offset-4">
            {indoor.name}
          </a>
        </h2>
        <p className="text-ink-soft">{indoor.city}</p>
        <a
          href={`https://www.google.com/maps/search/?${new URLSearchParams({ api: "1", query: where })}`}
          className={`${btn} self-start bg-crayon-blue`}
        >
          <Icon name="directions" size={24} />
          Directions
        </a>
        {pb?.why_kids ? <p>{pb.why_kids}</p> : null}
        {pb?.hours ? (
          <p>
            <b>Open:</b> {pb.hours}
          </p>
        ) : null}
        {pb?.cost ? (
          <p>
            <b>Cost:</b> {pb.cost}
          </p>
        ) : null}
      </section>
    );
  }
  const slug = issue.wheel_pick.park;
  const [park] = await db
    .select({ lat: parksTable.lat, lng: parksTable.lng })
    .from(parksTable)
    .where(eq(parksTable.slug, slug));
  const sat = addDays(issue.issue_date, 2);
  const day =
    goDay ??
    betterDay(
      sat,
      tiers ??
        Object.fromEntries(
          [sat, addDays(sat, 1)].map((d) => [
            d,
            roughTier(issue.weekend_ahead?.days?.find((x) => x.date === d)),
          ]),
        ),
    );
  const dayName = day === sat ? "Saturday" : "Sunday";
  const name = pick?.name ?? slug;
  const photo = issue.wheel_pick.photo;
  const bprd =
    photo && new URL(photo.src).hostname.endsWith("bendparksandrec.org");
  return (
    <section aria-labelledby="plan-h" className="flex flex-col gap-2">
      <h2 id="plan-h" className="font-hand text-3xl leading-tight">
        Go {dayName}:{" "}
        <Link href={`/parks/${slug}`} className="underline underline-offset-4">
          {name}
        </Link>
      </h2>
      <div className="flex flex-wrap gap-2">
        {park ? (
          <a
            href={directionsUrl({ lat: park.lat, lng: park.lng, name })}
            className={`${btn} bg-crayon-blue`}
          >
            <Icon name="directions" size={24} />
            Directions
          </a>
        ) : null}
        <Link
          href={`/parks/${slug}`}
          className="crayon-btn wax flex min-h-12 items-center bg-crayon-yellow px-4 text-xl"
        >
          See the park
        </Link>
      </div>
      <figure className="flex flex-col gap-1">
        {/* eslint-disable-next-line @next/next/no-img-element -- a credited outside photo, or our own card */}
        <img
          src={photo?.src ?? `/parks/${slug}/opengraph-image`}
          alt={photo?.alt ?? `${name} on Park Roulette`}
          width={photo?.width ?? 1200}
          height={photo?.height ?? 630}
          className="aspect-[2/1] w-full rounded-xl border-[3px] border-ink object-cover"
        />
        {photo ? (
          <figcaption className="text-xs text-ink-soft">
            Photo:{" "}
            {bprd ? (
              <a href={photo.sourceUrl} className="underline">
                Bend Park &amp; Recreation District
              </a>
            ) : (
              <>
                {photo.author}, {photo.license}, via{" "}
                <a href={photo.sourceUrl} className="underline">
                  Wikimedia Commons
                </a>
              </>
            )}
          </figcaption>
        ) : null}
      </figure>
      <p>
        <b>Why now.</b> {issue.wheel_pick.why_now}
      </p>
      <p>
        <b>Who it&apos;s for.</b> {issue.wheel_pick.who_for}
      </p>
      <p>
        <b>Bring.</b> {issue.wheel_pick.bring}
      </p>
    </section>
  );
}

/**
 * An issue that went out (drafts, skipped and failed weeks are never
 * public), as a landing page: what this is, the weather, where to go, the
 * signup, then the rest of the issue.
 */
async function Issue({ params, searchParams }: Props) {
  await connection(); // the date and time matter here
  const { date } = await params;
  const fromText = (await searchParams).src === "text";
  const sent = isIsoDate(date) ? await sentIssue(date) : null;
  if (!sent) notFound();
  const { issue } = sent;
  const all = await loadParks();
  const parks = new Map(
    all.map((p) => [p.slug, { name: p.name, city: p.city }]),
  );
  const tiers = planTiers(sent.plan);
  // Friday's update, when it changed the plan, decides what the page leads
  // with (the text named it).
  const friday = sent.plan?.friday_update?.plan;
  const indoor = friday
    ? friday.kind === "indoor"
      ? indoorVenue(issue)
      : null
    : indoorWeek(issue, sent.plan);
  // Built by our template from validated JSON: every string is escaped.
  const options = {
    catalog: CATALOG,
    site: SITE_URL,
    number: sent.number,
    park: (slug: string) => parks.get(slug),
    links: "direct",
    eventPages: true,
    unsubscribeUrl: null,
    postalAddress: null,
    landing: indoor ? "indoor" : "park",
    ...sent.images,
  } satisfies RenderOptions;
  const pick = parks.get(issue.wheel_pick.park);
  // Past the weekend's Sunday (Pacific), lead with this week's plan.
  const over = pacific(new Date()).date > weekendOf(date).to;
  const latest = over ? (await sentIssues(1))[0]?.issueDate : null;
  const days = issue.weekend_ahead?.days;
  const card = sent.images.weatherImage && hasWeatherCard(days);
  const update = sent.plan?.friday_update?.words;
  const sentOn = sent.sentAt.toLocaleDateString("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  return (
    <article className="flex flex-col gap-4">
      <TextTapBeacon date={date} />
      {over ? (
        <p className="doodle-box-alt px-4 py-3 leading-snug">
          This was for {weekendRange(date)}.{" "}
          {latest && latest !== date ? (
            <Link
              href={`/newsletter/${latest}`}
              className="font-bold underline"
            >
              This week&apos;s plan
            </Link>
          ) : (
            <Link href="/" className="font-bold underline">
              Spin for a park today
            </Link>
          )}
        </p>
      ) : null}
      <p className="text-sm leading-snug text-ink-soft">{KICKER}</p>
      <div className="flex flex-col gap-1">
        <h1 className="font-hand text-4xl leading-tight text-balance">
          {issue.subject}
        </h1>
        <p className="font-hand text-2xl text-ink-soft">
          For {weekendRange(date)}
        </p>
      </div>
      {update ? (
        <p className="rounded-xl border-2 border-dashed border-ink px-3 py-2 leading-snug">
          <b>Friday update:</b> {update}.
        </p>
      ) : null}
      {card && days ? (
        // eslint-disable-next-line @next/next/no-img-element -- the frozen card, as in the email
        <img
          src={weatherImageUrl(SITE_URL, issue) ?? undefined}
          alt={forecastWords(days)}
          {...weatherImageSize(days)}
          className="h-auto w-full"
        />
      ) : days ? (
        <p>{forecastWords(days)}</p>
      ) : null}
      <ThePlan
        issue={issue}
        tiers={tiers}
        indoor={indoor}
        pick={pick}
        goDay={friday?.kind === "park" ? friday.date : undefined}
      />
      <Suspense fallback={null}>
        <Signup fromText={fromText} />
      </Suspense>
      <IssueCard
        issue={issue}
        options={options}
        className="overflow-hidden rounded-xl border-[3px] border-ink bg-[#fffaf0] [&_ul]:list-disc"
      />
      {pick ? (
        <p className="text-sm">
          More on{" "}
          <Link href={`/parks/${issue.wheel_pick.park}`} className="underline">
            {pick.name}
          </Link>{" "}
          and{" "}
          <Link href={townHref(pick.city)} className="underline">
            playgrounds in {pick.city}
          </Link>
          .
        </p>
      ) : null}
      <nav aria-label="More issues" className="flex justify-between gap-3">
        {sent.prev ? (
          <Link href={`/newsletter/${sent.prev}`} className="chip min-h-11">
            Previous: {shortDate(sent.prev)}
          </Link>
        ) : (
          <span />
        )}
        {sent.next ? (
          <Link href={`/newsletter/${sent.next}`} className="chip min-h-11">
            Next: {shortDate(sent.next)}
          </Link>
        ) : null}
      </nav>
      <p className="text-sm text-ink-soft">
        Sent {sentOn}.{" "}
        <Link href="/newsletter" className="underline">
          Every issue
        </Link>
      </p>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Article",
          headline: issue.subject,
          description: issue.preview,
          datePublished: sent.sentAt.toISOString(),
          url: `${SITE_URL}/newsletter/${date}`,
          image: `${SITE_URL}/newsletter/${date}/preview.jpg`,
          author: {
            "@type": "Person",
            name: "James",
            url: `${SITE_URL}/newsletter`,
          },
          publisher: {
            "@type": "Organization",
            name: "True Craft Ventures LLC",
            url: SITE_URL,
          },
          isPartOf: {
            "@type": "Periodical",
            "@id": `${SITE_URL}/newsletter#periodical`,
            name: NEWS_NAME,
          },
          about: {
            "@type": "Place",
            url: `${SITE_URL}/parks/${issue.wheel_pick.park}`,
            name: pick?.name,
          },
        }}
      />
    </article>
  );
}

export default function IssuePage(props: Props) {
  return (
    <Suspense fallback={<CrayonLoading label="Finding that issue…" />}>
      <Issue {...props} />
    </Suspense>
  );
}
