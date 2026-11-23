import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { EventCard, EventChips } from "@/components/events/EventBits";
import { Icon } from "@/components/icons";
import { CrayonLoading } from "@/components/Loading";
import { JsonLd } from "@/components/seo/JsonLd";
import { nearestTown, townForecast, weatherFor } from "@/lib/events/forecast";
import {
  clock,
  domainOf,
  eventDescription,
  eventJsonLd,
  eventLinkLabel,
  eventTitle,
  groupBounds,
  groupOf,
  longDate,
  monthDay,
  pacificToday,
  shortDate,
  upcomingDates,
  weeklyPattern,
  whenLine,
} from "@/lib/events/model";
import {
  miles,
  nearbyPlaygrounds,
  playgroundOnSite,
} from "@/lib/events/nearby";
import {
  allEvents,
  eventBySlug,
  listed,
  listedInIssueOn,
  nextStatus,
} from "@/lib/events/store";
import { featuredEvent } from "@/lib/news/data";
import { directionsUrl } from "@/lib/geo";
import { addDays, pacific } from "@/lib/news/time";
import { publicParks } from "@/lib/seo-data";
import { SITE_URL } from "@/lib/site";

type Props = { params: Promise<{ slug: string }> };

async function load(slug: string) {
  await connection();
  const row = await eventBySlug(slug);
  return row;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const row = await load(slug);
  if (!row) return { title: "Lost event", robots: { index: false } };
  const now = new Date();
  const next = upcomingDates(row.data, now)[0] ?? null;
  const parks = await publicParks();
  const near = nearbyPlaygrounds(row.data.point, parks, { n: 1 })[0];
  const title = eventTitle(row.data, row.kind, next);
  const description = eventDescription(row.data, near?.name ?? null);
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: `/events/${row.slug}` },
    // Passed, couldn't confirm, or a series with no next date: noindex
    // (never a 410: newsletter issues link here forever).
    ...(listed(row, now) ? {} : { robots: { index: false, follow: true } }),
    openGraph: {
      title,
      description,
      type: "website",
      images: [
        {
          url: `/events/${row.slug}/image/16x9`,
          width: 1200,
          height: 675,
        },
      ],
    },
  };
}

export default function EventPage(props: Props) {
  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="Breadcrumb" className="text-sm text-ink-soft">
        <Link href="/" className="underline">
          Park Roulette
        </Link>{" "}
        ›{" "}
        <Link href="/events" className="underline">
          Kids&apos; events
        </Link>
      </nav>
      <Suspense fallback={<CrayonLoading label="Finding the event…" />}>
        <Event {...props} />
      </Suspense>
    </div>
  );
}

function Note({
  children,
  tone = "paper",
}: {
  children: React.ReactNode;
  tone?: "paper" | "yellow";
}) {
  return (
    <div
      role="note"
      className={`doodle-box px-4 py-3 leading-snug ${tone === "yellow" ? "bg-[color-mix(in_srgb,var(--color-crayon-yellow)_40%,#fffdf7)]" : ""}`}
    >
      {children}
    </div>
  );
}

async function Event({ params }: Props) {
  const { slug } = await params;
  const loaded = await load(slug);
  if (!loaded) notFound();
  const now = new Date();
  const today = pacificToday(now);
  // The status shown is the next date's (sticky per date).
  const row = { ...loaded, status: nextStatus(loaded, now) };
  const e = row.data;
  const upcoming = upcomingDates(e, now);
  const next = upcoming[0] ?? null;
  const shownDate =
    next ?? [...e.dates].sort((a, b) => b.day.localeCompare(a.day))[0];
  const [parks, rows, featured] = await Promise.all([
    publicParks(),
    allEvents(),
    featuredEvent(row.slug),
  ]);
  const unconfirmed = row.confirm === "unconfirmed";
  const passed = !next;
  const series = row.kind !== "one_off";
  const onSite = playgroundOnSite(e, parks);
  const near = nearbyPlaygrounds(e.point, parks, { n: 3, skip: onSite?.slug });
  const pattern = weeklyPattern(upcoming);
  const seriesDates = upcoming
    .filter((d) => d.day <= addDays(today, 60))
    .slice(0, 8);

  // Weather: within 7 days, at the forecast point nearest the venue.
  let weather: string | null = null;
  if (next && next.day <= addDays(today, 7) && !unconfirmed) {
    const town = nearestTown(e.point, e.venue.town);
    const w = weatherFor(
      await townForecast(town),
      town,
      next.day,
      next.start,
      longDate(next.day).split(",")[0],
      next.start ? clock(next.start) : null,
    );
    if (w)
      weather =
        e.setting === "indoor"
          ? `${w.line}. It's indoors, so you're set.`
          : w.cold || w.wet
            ? `Bundle up: ${w.line.split(": ")[1]}.`
            : `${w.line}.`;
  }

  const more = rows
    .filter((r) => r.id !== row.id && listed(r, now))
    .map((r) => ({
      r: { ...r, status: nextStatus(r, now) },
      n: upcomingDates(r.data, now)[0],
    }))
    .filter((x) => groupOf(x.n.day, today) === "weekend")
    .sort((a, b) => a.n.day.localeCompare(b.n.day))
    .slice(0, 3);
  const bounds = groupBounds(today);

  // A small organizer's Instagram, Facebook, booking or chamber page:
  // never called official. An Instagram, Facebook or booking page stands
  // on a newsletter issue: say when it was listed, never "seen".
  const link = eventLinkLabel(e.url);
  const official = link.noun === "official page";
  const byIssue = link.byIssue;
  const listedOn = byIssue ? await listedInIssueOn(e) : null;
  const signup =
    e.signup?.kind === "required"
      ? `Required: sign up on the ${link.noun}`
      : e.signup?.kind === "sellout"
        ? "Tickets sell out, so book ahead"
        : e.signup?.kind === "none"
          ? "Not needed. Just come."
          : null;

  return (
    <>
      {row.status === "canceled" && !passed ? (
        <Note tone="yellow">
          <b>Canceled</b>
          {official ? ", says the official page" : ""}
          {row.stateChangedAt
            ? ` (${monthDay(pacific(row.stateChangedAt).date)})`
            : ""}
          .
        </Note>
      ) : null}
      {row.status === "postponed" && !passed ? (
        <Note tone="yellow">
          <b>Postponed.</b> No new date yet.
        </Note>
      ) : null}
      {row.status === "rescheduled" && next && e.status?.previous_day ? (
        <Note tone="yellow">
          <b>New date: {shortDate(next.day)}</b> (was{" "}
          {monthDay(e.status.previous_day)}).
        </Note>
      ) : null}
      {unconfirmed && !passed ? (
        <Note>
          We couldn&apos;t confirm this one
          {official ? " on its official page" : ""} anymore. Check the source
          before you go.
        </Note>
      ) : null}
      {passed && !series ? (
        <Note>
          This event has passed. Here&apos;s what&apos;s coming up instead.
        </Note>
      ) : null}
      {passed && series ? (
        <Note>
          Last held {longDate(shownDate.day).replace(/^\w+, /, "")}. We&apos;ll
          add the next one when it&apos;s announced.
        </Note>
      ) : null}

      <header className="flex flex-col gap-2">
        <h1 className="font-hand text-5xl leading-tight text-balance">
          {e.title}
        </h1>
        <EventChips row={row} />
      </header>

      <dl className="doodle-box grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 px-4 py-3 text-[0.98rem] leading-snug">
        <dt className="font-hand text-lg">When</dt>
        <dd>
          {passed && !series ? (
            <>This was on {longDate(shownDate.day)}.</>
          ) : pattern ? (
            <>
              {pattern}. Next:{" "}
              <time dateTime={next!.day}>{shortDate(next!.day)}</time>
            </>
          ) : (
            <time
              dateTime={
                shownDate.start
                  ? `${shownDate.day}T${shownDate.start}`
                  : shownDate.day
              }
            >
              {row.status === "canceled" ? (
                <s>{whenLine(shownDate)}</s>
              ) : (
                whenLine(shownDate)
              )}
            </time>
          )}
        </dd>
        <dt className="font-hand text-lg">Where</dt>
        <dd>
          {e.venue.name}
          {e.venue.street ? `, ${e.venue.street}` : ""}, {e.venue.town}
        </dd>
        {e.cost ? (
          <>
            <dt className="font-hand text-lg">Cost</dt>
            <dd>{e.cost.text}</dd>
          </>
        ) : null}
        {e.ages?.tags.length ? (
          <>
            <dt className="font-hand text-lg">Ages</dt>
            <dd>
              {e.ages.tags.join(", ")}
              {e.ages_text && e.ages.tags[0] !== "All ages" ? (
                <span className="text-ink-soft">
                  {" "}
                  (the page says &ldquo;{e.ages_text}&rdquo;)
                </span>
              ) : null}
            </dd>
          </>
        ) : null}
        {signup ? (
          <>
            <dt className="font-hand text-lg">Sign-up</dt>
            <dd>
              {e.signup?.kind === "required" ? (
                <a href={e.url} className="underline">
                  {signup}
                </a>
              ) : (
                signup
              )}
              {e.signup?.note ? `. ${e.signup.note}` : ""}
            </dd>
          </>
        ) : null}
        {e.parking ? (
          <>
            <dt className="font-hand text-lg">Parking</dt>
            <dd>{e.parking}</dd>
          </>
        ) : null}
        {listedOn ? (
          <dd className="col-span-2 text-sm text-ink-soft">
            Listed in a local newsletter on {monthDay(listedOn)}.
          </dd>
        ) : !byIssue && row.lastSeenAt ? (
          <dd className="col-span-2 text-sm text-ink-soft">
            Last seen on the {link.noun}{" "}
            {monthDay(pacific(row.lastSeenAt).date)}.
          </dd>
        ) : null}
      </dl>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          {e.point ? (
            <a
              href={directionsUrl({ ...e.point, name: e.venue.name })}
              className="crayon-btn wax flex min-h-12 items-center gap-2 bg-crayon-blue px-4 text-xl text-white [text-shadow:1px_1px_0_#2b2a33]"
            >
              <span aria-hidden>
                <Icon name="directions" size={24} />
              </span>
              Directions
            </a>
          ) : null}
          {!series && next ? (
            <a
              href={`/events/${row.slug}/calendar.ics?d=${next.day}${next.start ? `&t=${next.start}` : ""}`}
              className="crayon-btn wax flex min-h-12 items-center gap-2 bg-crayon-yellow px-4 text-xl"
            >
              <span aria-hidden>
                <Icon name="calendar" size={24} />
              </span>
              Add to calendar
            </a>
          ) : null}
        </div>
        <a href={e.url} className="flex min-h-11 items-center underline">
          {link.label}: {e.organizer?.name ?? e.venue.name} ↗
          <span className="sr-only">
            {" "}
            (opens the{" "}
            {link.noun === "official page" ? "official site" : link.noun})
          </span>
        </a>
        <p className="text-sm text-ink-soft">
          Plans change. Check it before you go.
        </p>
      </div>

      {series && seriesDates.length ? (
        <section aria-labelledby="dates-h" className="flex flex-col gap-2">
          <h2 id="dates-h" className="font-hand text-3xl">
            Upcoming dates
          </h2>
          <ul className="flex flex-col divide-y divide-dashed divide-ink/20">
            {seriesDates.map((d) => (
              <li
                key={`${d.day}${d.start ?? ""}`}
                className="flex min-h-12 items-center justify-between gap-3 py-1"
              >
                <time dateTime={d.start ? `${d.day}T${d.start}` : d.day}>
                  {whenLine(d)}
                </time>
                <a
                  href={`/events/${row.slug}/calendar.ics?d=${d.day}${d.start ? `&t=${d.start}` : ""}`}
                  className="chip min-h-11 shrink-0"
                  aria-label={`Add ${shortDate(d.day)} to calendar`}
                >
                  Add to calendar
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="what-h" className="flex flex-col gap-1">
        <h2 id="what-h" className="font-hand text-3xl">
          What kids do
        </h2>
        <p className="leading-snug">{e.what}</p>
      </section>

      {weather ? (
        <section aria-labelledby="wx-h" className="flex flex-col gap-1">
          <h2 id="wx-h" className="font-hand text-3xl">
            Weather
          </h2>
          <p className="flex items-center gap-2 leading-snug">
            <span aria-hidden>
              <Icon name="sun" size={26} />
            </span>
            {weather}
          </p>
        </section>
      ) : null}

      {e.point && (onSite || near.length) ? (
        <section aria-labelledby="near-h" className="flex flex-col gap-2">
          <h2 id="near-h" className="font-hand text-3xl">
            Playgrounds near {e.venue.name}
          </h2>
          <p className="-mt-1">Make a day of it.</p>
          <ul className="flex flex-col gap-2">
            {onSite ? (
              <li>
                <Link href={`/parks/${onSite.slug}`} className="underline">
                  {onSite.name}
                </Link>
                : playground on site
              </li>
            ) : null}
            {near.map((p) => (
              <li key={p.slug} className="flex flex-col">
                <Link
                  href={`/parks/${p.slug}`}
                  className="flex min-h-11 items-center gap-2 font-hand text-xl underline"
                >
                  {p.name}
                </Link>
                <span className="text-[0.95rem] text-ink-soft">
                  <span aria-label={`${p.miles.toFixed(1)} miles away`}>
                    {miles(p.miles)}
                  </span>
                  {p.stars != null ? ` · ${p.stars.toFixed(1)} stars` : ""}
                  {p.features.length ? ` · ${p.features.join(", ")}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="more-h" className="flex flex-col gap-3">
        <h2 id="more-h" className="font-hand text-3xl">
          {more.length ? "More this weekend" : "Coming up"}
        </h2>
        {featured ? (
          <p className="leading-snug">
            In{" "}
            <Link href={`/newsletter/${featured}`} className="underline">
              Bend Playground Passport, {monthDay(featured)}
            </Link>
            .
          </p>
        ) : null}
        {more.map(({ r, n }) => (
          <EventCard key={r.id} row={r} next={n} parks={parks} />
        ))}
        <Link
          href="/events"
          className="crayon-btn wax min-h-12 self-start bg-crayon-green px-5 text-xl text-white [text-shadow:1px_1px_0_#2b2a33]"
        >
          All kids&apos; events
        </Link>
        <span className="sr-only">
          This weekend runs {monthDay(bounds.weekend.from)} to{" "}
          {monthDay(bounds.weekend.to)}.
        </span>
      </section>

      <p className="text-sm text-ink-soft">From {domainOf(e.url)}</p>

      <JsonLd
        data={[
          ...(passed || row.confirm !== "ok" || e.ages?.kids === false
            ? []
            : eventJsonLd(row, now, SITE_URL)),
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
                name: "Kids' events",
                item: `${SITE_URL}/events`,
              },
              {
                "@type": "ListItem",
                position: 3,
                name: e.title,
                item: `${SITE_URL}/events/${row.slug}`,
              },
            ],
          },
        ]}
      />
    </>
  );
}
