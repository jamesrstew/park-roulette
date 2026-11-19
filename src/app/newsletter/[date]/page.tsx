import { connection } from "next/server";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CrayonLoading } from "@/components/Loading";
import { EmailSignup } from "@/components/ParkNews";
import { JsonLd } from "@/components/seo/JsonLd";
import { TextsLink } from "@/components/news/TextsLink";
import { getMe } from "@/lib/data";
import { CATALOG } from "@/lib/news/catalog";
import { loadParks, sentIssue } from "@/lib/news/data";
import { subscriptionFor } from "@/lib/news/subscribers";
import { NEWS_NAME, renderArchiveCard } from "@/lib/news/template";
import { daysBetween, isIsoDate, pacific, weekendOf } from "@/lib/news/time";
import { PARK_NEWS } from "@/lib/park-news";
import { SITE_URL } from "@/lib/site";
import { townHref } from "@/lib/towns";

type Props = { params: Promise<{ date: string }> };

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

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { date } = await params;
  const sent = isIsoDate(date) ? await sentIssue(date) : null;
  if (!sent) return { title: "Lost issue", robots: { index: false } };
  return {
    title: {
      absolute: `${sent.issue.subject}, ${weekendRange(date)} | ${NEWS_NAME}`,
    },
    description: sent.issue.preview,
    alternates: { canonical: `/newsletter/${date}` },
    openGraph: {
      type: "article",
      title: sent.issue.subject,
      description: sent.issue.preview,
    },
  };
}

/** A small signup under the issue, or nothing for a subscriber or a kid. */
async function Signup() {
  const me = await getMe();
  if (me?.isKid) return null;
  if (me && (await subscriptionFor(me.id)).status === "on") return null;
  return (
    <section
      aria-labelledby="issue-signup-h"
      className="doodle-box-alt flex flex-col gap-2 px-4 py-3"
    >
      <h2 id="issue-signup-h" className="font-hand text-2xl leading-tight">
        Get the next one on Thursday
      </h2>
      <EmailSignup source="issue_page" fine={PARK_NEWS.fineFull} />
    </section>
  );
}

/** An issue that went out (drafts, skipped and failed weeks are never public). */
async function Issue({ params }: Props) {
  await connection(); // the date and time matter here
  const { date } = await params;
  const sent = isIsoDate(date) ? await sentIssue(date) : null;
  if (!sent) notFound();
  const all = await loadParks();
  const parks = new Map(
    all.map((p) => [p.slug, { name: p.name, city: p.city }]),
  );
  // Built by our template from validated JSON: every string is escaped.
  const html = renderArchiveCard(sent.issue, {
    catalog: CATALOG,
    site: SITE_URL,
    number: sent.number,
    park: (slug) => parks.get(slug),
    links: "direct",
    unsubscribeUrl: null,
    postalAddress: null,
    ...sent.images,
  });
  const pick = parks.get(sent.issue.wheel_pick.park);
  const stale = daysBetween(date, pacific(new Date()).date) > 7;
  const sentOn = sent.sentAt.toLocaleDateString("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  return (
    <article className="flex flex-col gap-4">
      <nav aria-label="Breadcrumb" className="text-sm text-ink-soft">
        <Link href="/news" className="underline">
          The scoop
        </Link>{" "}
        ›{" "}
        <Link href="/newsletter" className="underline">
          {NEWS_NAME}
        </Link>
      </nav>
      <h1 className="font-hand text-4xl leading-tight text-balance">
        {sent.issue.subject}
      </h1>
      <div className="text-sm text-ink-soft">
        <p>Sent {sentOn}.</p>
        {stale ? (
          <p>
            This forecast was for {weekendRange(date)}.{" "}
            <Link href="/" className="underline">
              Spin for a park today.
            </Link>
          </p>
        ) : null}
      </div>
      <div
        className="overflow-hidden rounded-xl border-[3px] border-ink bg-[#fffaf0] [&_ul]:list-disc"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {pick ? (
        <p className="text-sm">
          More on{" "}
          <Link
            href={`/parks/${sent.issue.wheel_pick.park}`}
            className="underline"
          >
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
      <Suspense fallback={null}>
        <Signup />
      </Suspense>
      <TextsLink />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Article",
          headline: sent.issue.subject,
          description: sent.issue.preview,
          datePublished: sent.sentAt.toISOString(),
          url: `${SITE_URL}/newsletter/${date}`,
          image: `${SITE_URL}/parks/${sent.issue.wheel_pick.park}/opengraph-image`,
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
            url: `${SITE_URL}/parks/${sent.issue.wheel_pick.park}`,
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
