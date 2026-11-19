import { connection } from "next/server";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Icon } from "@/components/icons";
import { CrayonLoading } from "@/components/Loading";
import { PageTitle } from "@/components/PageTitle";
import { EmailSignup } from "@/components/ParkNews";
import { JsonLd } from "@/components/seo/JsonLd";
import { TextsLink } from "@/components/news/TextsLink";
import { getMe } from "@/lib/data";
import { CATALOG } from "@/lib/news/catalog";
import {
  loadParks,
  nextIssueDate,
  sentIssue,
  sentIssues,
} from "@/lib/news/data";
import { subscriptionFor } from "@/lib/news/subscribers";
import { renderArchiveCard } from "@/lib/news/template";
import { longDate } from "@/lib/news/time";
import { NEWS_NAME, PARK_NEWS } from "@/lib/park-news";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: {
    absolute: "Bend Playground Passport: a free weekly playground email",
  },
  description:
    "Every Thursday morning: the weekend forecast, one Central Oregon playground to try, an indoor backup for bad weather, and park closures. Free.",
  alternates: {
    canonical: "/newsletter",
    types: { "application/rss+xml": "/newsletter/rss.xml" },
  },
};

/** "Thursday, November 19, 2026" */
function sentLine(d: Date): string {
  return d.toLocaleDateString("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

const LINES: [Parameters<typeof Icon>[0]["name"], string][] = [
  ["sun", "The weekend ahead, Friday to Sunday"],
  ["playground", "A featured park, and who it suits"],
  ["home", "An indoor backup for bad weather"],
  ["heads_up", "Closures and openings, only when they change"],
];

/** The signup card, or (signed in and on) where to manage it. */
async function SignupCard() {
  const me = await getMe();
  if (me?.isKid) return null;
  const sub = me ? await subscriptionFor(me.id) : null;
  return (
    <section
      id="signup"
      aria-labelledby="signup-h"
      className="doodle-box-alt flex scroll-mt-6 flex-col gap-2 bg-[color-mix(in_srgb,var(--color-crayon-blue)_8%,#fffdf7)] px-4 py-4"
    >
      <h2
        id="signup-h"
        className="flex items-center gap-2 font-hand text-3xl leading-tight"
      >
        <Icon name="mail" size={32} /> Get it on Thursdays
      </h2>
      {sub?.status === "on" ? (
        <p className="leading-snug">
          You get it every Thursday.{" "}
          <Link href="/me" className="underline">
            Manage it in Family &amp; settings.
          </Link>
        </p>
      ) : (
        <>
          <p className="-mt-1 leading-snug">{PARK_NEWS.pitch}</p>
          <EmailSignup source="newsletter" fine={PARK_NEWS.fineFull} />
        </>
      )}
    </section>
  );
}

async function Latest() {
  await connection(); // the date and time matter here
  const [issues, next] = await Promise.all([sentIssues(), nextIssueDate()]);
  const latest = issues[0] ? await sentIssue(issues[0].issueDate) : null;
  const parks = latest
    ? new Map(
        (await loadParks()).map((p) => [
          p.slug,
          { name: p.name, city: p.city },
        ]),
      )
    : null;
  // Built by our template from validated JSON: every string is escaped.
  const html =
    latest && parks
      ? renderArchiveCard(latest.issue, {
          catalog: CATALOG,
          site: SITE_URL,
          number: latest.number,
          park: (slug) => parks.get(slug),
          links: "direct",
          unsubscribeUrl: null,
          postalAddress: null,
          ...latest.images,
        })
      : null;
  return (
    <>
      <section aria-labelledby="latest-h" className="flex flex-col gap-2">
        <h2 id="latest-h" className="font-hand text-3xl">
          The latest issue
        </h2>
        {latest && html ? (
          <>
            <p className="text-sm text-ink-soft">
              Sent {sentLine(latest.sentAt)} · {latest.issue.preview}
            </p>
            <div className="relative max-h-[34rem] overflow-hidden rounded-xl border-[3px] border-ink bg-[#fffaf0]">
              <div
                className="[&_ul]:list-disc"
                dangerouslySetInnerHTML={{ __html: html }}
              />
              <div
                aria-hidden
                className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-b from-transparent to-[#fffaf0]"
              />
            </div>
            <Link
              href={`/newsletter/${latest.issue.issue_date}`}
              className="flex min-h-11 items-center self-center font-hand text-xl underline underline-offset-4"
            >
              Read the whole issue
            </Link>
          </>
        ) : (
          <p className="leading-snug">
            Issue 1 comes {longDate(next).replace(/, \d{4}$/, "")}, a Thursday.
            Sign up above and it lands in your inbox that morning.
          </p>
        )}
      </section>
      <section aria-labelledby="every-h" className="flex flex-col gap-1">
        <h2 id="every-h" className="font-hand text-3xl">
          Every issue
        </h2>
        {issues.length ? (
          <ul className="flex flex-col divide-y divide-dashed divide-ink/20">
            {issues.map((i) => (
              <li key={i.issueDate}>
                <Link
                  href={`/newsletter/${i.issueDate}`}
                  className="flex min-h-11 items-center gap-3 py-2"
                >
                  <span className="w-14 shrink-0 text-sm text-ink-soft">
                    {new Date(`${i.issueDate}T12:00:00Z`).toLocaleDateString(
                      "en-US",
                      {
                        timeZone: "UTC",
                        month: "short",
                        day: "numeric",
                      },
                    )}
                  </span>
                  <span className="underline underline-offset-2">
                    {i.subject}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="leading-snug">
            Issue 1 comes {longDate(next).replace(/, \d{4}$/, "")}.
          </p>
        )}
      </section>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "CollectionPage",
              "@id": `${SITE_URL}/newsletter`,
              url: `${SITE_URL}/newsletter`,
              name: NEWS_NAME,
              description: PARK_NEWS.tagline,
              mainEntity: { "@id": `${SITE_URL}/newsletter#periodical` },
            },
            {
              "@type": "Periodical",
              "@id": `${SITE_URL}/newsletter#periodical`,
              name: NEWS_NAME,
              url: `${SITE_URL}/newsletter`,
              inLanguage: "en-US",
              isAccessibleForFree: true,
              publisher: {
                "@type": "Organization",
                name: "True Craft Ventures LLC",
                url: SITE_URL,
              },
            },
            {
              "@type": "ItemList",
              itemListElement: issues.map((i, n) => ({
                "@type": "ListItem",
                position: n + 1,
                url: `${SITE_URL}/newsletter/${i.issueDate}`,
                name: i.subject,
              })),
            },
            {
              "@type": "BreadcrumbList",
              itemListElement: [
                {
                  "@type": "ListItem",
                  position: 1,
                  name: "The scoop",
                  item: `${SITE_URL}/news`,
                },
                {
                  "@type": "ListItem",
                  position: 2,
                  name: NEWS_NAME,
                  item: `${SITE_URL}/newsletter`,
                },
              ],
            },
          ],
        }}
      />
    </>
  );
}

export default function NewsletterPage() {
  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Breadcrumb" className="text-sm text-ink-soft">
        <Link href="/news" className="underline">
          The scoop
        </Link>{" "}
        › {NEWS_NAME}
      </nav>
      <PageTitle
        lead="Bend Playground"
        accent="Passport"
        color="blue"
        underline="yellow"
        underlineWidth="w-48"
        subtitle={
          <p>
            {PARK_NEWS.tagline} {PARK_NEWS.cadence}
          </p>
        }
      />
      <Suspense fallback={<CrayonLoading label="Finding the sign-up…" />}>
        <SignupCard />
      </Suspense>
      <ul className="grid grid-cols-2 gap-3 text-sm leading-snug">
        {LINES.map(([icon, line]) => (
          <li key={line} className="flex items-start gap-2">
            <Icon name={icon} size={28} className="shrink-0" />
            {line}
          </li>
        ))}
      </ul>
      <Suspense fallback={<CrayonLoading label="Finding the latest issue…" />}>
        <Latest />
      </Suspense>
      <TextsLink />
      <p className="text-sm text-ink-soft">
        Written by James, a Bend dad who made Park Roulette.{" "}
        <a href="/newsletter/rss.xml" className="underline">
          RSS
        </a>
      </p>
    </div>
  );
}
