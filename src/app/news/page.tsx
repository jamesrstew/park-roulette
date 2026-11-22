import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Icon } from "@/components/icons";
import { PageTitle } from "@/components/PageTitle";
import { JoinNudge } from "@/components/park/JoinNudge";
import {
  CARD,
  EventsHeading,
  ScoopEvents,
} from "@/components/news/scoop/ScoopEvents";
import { ScoopReviews } from "@/components/news/scoop/ScoopReviews";
import { ScoopTracker } from "@/components/news/scoop/ScoopTracker";
import { ScoopWeather } from "@/components/news/scoop/ScoopWeather";
import { getMe } from "@/lib/data";
import { freshReviews } from "@/lib/data-feed";
import { townForecast } from "@/lib/events/forecast";
import { allEvents } from "@/lib/events/store";
import { latestIssue } from "@/lib/news/data";
import type { TextPeriod } from "@/lib/news/tiers";
import { issueRow, scoopEvents, scoopWeather } from "@/lib/scoop";

export const metadata: Metadata = { title: "The scoop" };

/**
 * The scoop: Bend's next 3 days, this week's pick, kids' events coming up,
 * and fresh reviews. The title and headings are the static shell; each
 * block streams in its own Suspense behind a same-size placeholder.
 */
export default function NewsPage() {
  return (
    <ScoopTracker>
      <PageTitle
        lead="The"
        accent="scoop"
        color="teal"
        underline="pink"
        underlineWidth="w-28"
      />
      <Suspense fallback={<Placeholder className="h-[10.25rem]" />}>
        <Weather />
      </Suspense>
      <Suspense fallback={<Placeholder className="h-[3.75rem]" />}>
        <IssueRow />
      </Suspense>
      <section aria-labelledby="scoop-events-h" className="flex flex-col gap-2">
        <EventsHeading />
        <Suspense
          fallback={
            <div>
              <div className="flex gap-3 overflow-hidden pt-3 pb-3">
                <Placeholder className={CARD} />
                <Placeholder className={CARD} />
              </div>
              {/* With a mouse, the carousel's arrows sit under it. */}
              <div className="mt-1 hidden h-11 [@media(pointer:fine)]:block" />
            </div>
          }
        >
          <Events />
        </Suspense>
      </section>
      <section
        aria-labelledby="scoop-reviews-h"
        className="flex flex-col gap-2"
      >
        <h2 id="scoop-reviews-h" className="font-hand text-2xl leading-none">
          Fresh reviews
        </h2>
        <Suspense
          fallback={
            <div className="flex flex-col gap-3">
              <Placeholder className="h-32" />
              <Placeholder className="h-32" />
              <Placeholder className="h-32" />
            </div>
          }
        >
          <Reviews />
        </Suspense>
      </section>
    </ScoopTracker>
  );
}

/** A soft dashed box the size of what's coming. */
function Placeholder({ className }: { className: string }) {
  return (
    <div
      aria-hidden
      className={`${className} animate-pulse rounded-[var(--radius-wobbly)] border-2 border-dashed border-ink/20 bg-white/50`}
    />
  );
}

async function Weather() {
  await connection();
  const f = await townForecast("Bend");
  const days = scoopWeather(
    f?.daily as readonly TextPeriod[] | undefined,
    new Date(),
  );
  return days ? <ScoopWeather days={days} /> : null;
}

/**
 * Thursday to Sunday of an issue's week: its wheel pick. Other days: the
 * latest issue. Nothing before the first issue goes out.
 */
async function IssueRow() {
  await connection();
  const issue = await latestIssue();
  if (!issue) return null;
  const row = issueRow(issue, new Date());
  const pick = row.kind === "pick" ? row.pick : null;
  return (
    <p className="doodle-box-alt flex h-[3.75rem] items-center gap-2.5 px-3 leading-snug">
      <Icon name={pick ? "stamp" : "mail"} size={26} className="shrink-0" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-xs leading-tight text-ink-soft">
          {pick ? "This weekend's pick" : "Latest issue"}
        </span>
        {pick ? (
          <Link
            href={`/parks/${pick.slug}`}
            data-scoop="pick"
            className="truncate py-1 font-hand text-xl leading-tight underline underline-offset-2"
          >
            {pick.name}
          </Link>
        ) : (
          <Link
            href={`/newsletter/${issue.issueDate}`}
            data-scoop="issue"
            className="truncate py-1 leading-tight underline underline-offset-2"
          >
            {issue.subject}
          </Link>
        )}
      </span>
      {pick ? (
        <Link
          href={`/newsletter/${issue.issueDate}`}
          data-scoop="issue"
          className="flex min-h-11 shrink-0 items-center px-1 text-sm underline underline-offset-2"
        >
          Read it
        </Link>
      ) : null}
    </p>
  );
}

async function Events() {
  await connection();
  const events = scoopEvents(await allEvents(), new Date());
  return <ScoopEvents events={events} />;
}

async function Reviews() {
  await connection();
  const me = await getMe();
  const reviews = await freshReviews(me);
  const now = new Date();
  return (
    <>
      <ScoopReviews reviews={reviews} now={now.getTime()} />
      {reviews.length ? (
        <p className="text-center text-xs leading-snug text-ink-soft">
          Reviews from other families show up an hour after they&apos;re
          written, so nobody can tell where you are right now.
        </p>
      ) : null}
      {!me ? (
        <JoinNudge icon="eyes" line="Families see more reviews. Hop in!" />
      ) : null}
    </>
  );
}
