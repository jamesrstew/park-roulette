import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { EventCard } from "@/components/events/EventBits";
import { Icon } from "@/components/icons";
import { CrayonLoading } from "@/components/Loading";
import { PageTitle } from "@/components/PageTitle";
import { JsonLd } from "@/components/seo/JsonLd";
import { AGE_BRACKETS, type AgeKey, matchesAge } from "@/lib/events/ages";
import { townForecast, weatherFor } from "@/lib/events/forecast";
import {
  type EventRow,
  GROUP_NAMES,
  type GroupKey,
  groupBounds,
  groupOf,
  isFree,
  monthDay,
  pacificToday,
  upcomingDates,
} from "@/lib/events/model";
import { allEvents, listed, nextStatus } from "@/lib/events/store";
import { CATALOG } from "@/lib/news/catalog";
import { publicParks } from "@/lib/seo-data";
import { SITE_URL } from "@/lib/site";
import { milesBetween } from "@/lib/geo";
import { townSlug } from "@/lib/towns";

type Search = Record<string, string | string[] | undefined>;
type Props = { searchParams: Promise<Search> };

/** The filters, read strictly (anything else is ignored). */
type Filters = {
  town: string | null;
  setting: "indoor" | "outdoor" | null;
  free: boolean;
  age: AgeKey | null;
};

function readFilters(sp: Search): Filters {
  const one = (k: string) =>
    typeof sp[k] === "string" ? (sp[k] as string) : "";
  const setting = one("setting");
  const age = one("age");
  return {
    town: /^[a-z0-9-]{2,40}$/.test(one("town")) ? one("town") : null,
    setting: setting === "indoor" || setting === "outdoor" ? setting : null,
    free: one("free") === "1",
    age: (AGE_BRACKETS.map((b) => b.key) as string[]).includes(age)
      ? (age as AgeKey)
      : null,
  };
}

/** One view, one URL: town, setting, free, age, always in that order. */
function href(f: Filters): string {
  const q = new URLSearchParams();
  if (f.town) q.set("town", f.town);
  if (f.setting) q.set("setting", f.setting);
  if (f.free) q.set("free", "1");
  if (f.age) q.set("age", f.age);
  const s = q.toString();
  return s ? `/events?${s}` : "/events";
}

const filtered = (f: Filters) => !!(f.town || f.setting || f.free || f.age);

function townName(slug: string, rows: EventRow[]): string {
  const r = rows.find((x) => townSlug(x.data.venue.town) === slug);
  return r?.data.venue.town ?? slug.replace(/-/g, " ");
}

function describe(f: Filters, rows: EventRow[]): string {
  const bits: string[] = [];
  if (f.free) bits.push("Free");
  if (f.setting) bits.push(f.setting === "indoor" ? "Indoor" : "Outdoor");
  let s = bits.length
    ? bits.join(", ").replace("Free, I", "Free i").replace("Free, O", "Free o")
    : "";
  if (f.age) s = `${s ? `${s} for ` : "For "}ages ${f.age}`;
  if (f.town) s = `${s || "Everything"} in ${townName(f.town, rows)}`;
  return s || "Everything";
}

const TITLE = "Kids' events in Bend and Central Oregon | Park Roulette";

/** "Indoor kids' events in Redmond", "Free kids' events for ages 4-7 in Central Oregon". */
function viewTitle(f: Filters, rows: EventRow[]): string {
  const lead = [
    f.free ? "Free" : null,
    f.setting ? (f.setting === "indoor" ? "indoor" : "outdoor") : null,
  ]
    .filter(Boolean)
    .join(" ");
  const kind = lead
    ? `${lead[0].toUpperCase()}${lead.slice(1)} kids' events`
    : "Kids' events";
  const ages = f.age ? ` for ages ${f.age}` : "";
  const where = f.town ? townName(f.town, rows) : "Central Oregon";
  return `${kind}${ages} in ${where} | Park Roulette`;
}

export async function generateMetadata({
  searchParams,
}: Props): Promise<Metadata> {
  const f = readFilters(await searchParams);
  let title = TITLE;
  if (filtered(f)) {
    await connection();
    title = viewTitle(f, await allEvents());
  }
  return {
    title: { absolute: title },
    description:
      "Upcoming kid-friendly events in Bend, Redmond, Sisters and beyond, each linked to its official page, with indoor picks and playgrounds nearby.",
    // Every filter canonicalizes to the listing (never also noindex).
    alternates: { canonical: "/events" },
  };
}

export default function EventsPage(props: Props) {
  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="Breadcrumb" className="text-sm text-ink-soft">
        <Link href="/" className="underline">
          Park Roulette
        </Link>{" "}
        › Kids&apos; events
      </nav>
      <PageTitle
        lead="Kids'"
        accent="events"
        color="green"
        underline="yellow"
        underlineWidth="w-40"
        subtitle={
          <p className="text-lg">
            Coming up in Central Oregon, with a link to each official page.
          </p>
        }
      />
      <Suspense fallback={<CrayonLoading label="Finding events…" />}>
        <Listing {...props} />
      </Suspense>
    </div>
  );
}

async function Listing({ searchParams }: Props) {
  await connection();
  const now = new Date();
  const today = pacificToday(now);
  const f = readFilters(await searchParams);
  const [rows, parks] = await Promise.all([allEvents(), publicParks()]);
  const live = rows
    .filter((r) => listed(r, now))
    // The status shown is the next date's (sticky per date).
    .map((r) => ({
      r: { ...r, status: nextStatus(r, now) },
      next: upcomingDates(r.data, now)[0],
    }))
    .sort((a, b) =>
      a.next.day === b.next.day
        ? (a.next.start ?? "").localeCompare(b.next.start ?? "")
        : a.next.day.localeCompare(b.next.day),
    );
  const pass = (x: (typeof live)[number], g: Filters) =>
    (!g.town || townSlug(x.r.data.venue.town) === g.town) &&
    (!g.setting || x.r.data.setting === g.setting) &&
    (!g.free || isFree(x.r.data)) &&
    (!g.age || matchesAge(x.r.data.ages?.tags ?? [], g.age));
  const shown = live.filter((x) => pass(x, f));
  const bounds = groupBounds(today);
  const groups = (["week", "weekend", "next", "later"] as GroupKey[])
    .map((k) => ({
      k,
      items: shown.filter((x) => groupOf(x.next.day, today) === k),
    }))
    .filter((g) => g.items.length);
  const towns = [...new Set(live.map((x) => x.r.data.venue.town))].sort();
  const weekend = groups.find((g) => g.k === "weekend")?.items ?? [];

  // The weather strip: Saturday in Bend, and how many indoor picks.
  const indoor = weekend.filter((x) => x.r.data.setting === "indoor").length;
  const sat = bounds.weekend.from <= bounds.weekend.to ? satOf(bounds) : null;
  const w =
    sat && indoor && !f.setting
      ? weatherFor(
          await townForecast("Bend"),
          "Bend",
          sat,
          undefined,
          "Saturday",
          null,
        )
      : null;

  const nothingSoon = !live.some((x) => x.next.day <= addDaysStr(today, 14));
  return (
    <>
      {w ? (
        <p className="flex items-center gap-2 rounded-2xl border-2 border-dashed border-ink/50 bg-white/60 px-3 py-2 leading-snug">
          <span aria-hidden>
            <Icon name="sun" size={28} />
          </span>
          <span>
            {w.line}.{" "}
            <Link
              href={href({ ...f, setting: "indoor" })}
              className="underline"
            >
              {indoor} indoor {indoor === 1 ? "pick" : "picks"} this weekend
            </Link>
          </span>
        </p>
      ) : null}

      <FilterBar f={f} towns={towns} />
      {filtered(f) ? (
        <p className="-mt-2 leading-snug">
          {describe(f, rows)}: {shown.length}{" "}
          {shown.length === 1 ? "event" : "events"}.{" "}
          <Link href="/events" className="underline">
            Show all
          </Link>
        </p>
      ) : null}

      {groups.map((g) => (
        <section
          key={g.k}
          aria-labelledby={`g-${g.k}`}
          className="flex flex-col gap-3"
        >
          <h2 id={`g-${g.k}`} className="font-hand text-3xl">
            {GROUP_NAMES[g.k]}{" "}
            <span className="text-lg text-ink-soft">
              {g.k === "later"
                ? `through ${monthDay(bounds.later.to)}`
                : `${monthDay(bounds[g.k].from)} to ${monthDay(bounds[g.k].to)}`}
            </span>
          </h2>
          {g.items.map(({ r, next }) => (
            <EventCard
              key={r.id}
              row={r}
              next={next}
              parks={parks}
              through={
                next.end_day && next.day < today
                  ? `Through ${monthDay(next.end_day)}.`
                  : null
              }
            />
          ))}
        </section>
      ))}

      {!shown.length && filtered(f) ? (
        <FilterEmpty
          f={f}
          live={live.map((x) => x.r)}
          pass={(r) =>
            pass(
              { r, next: upcomingDates(r.data, now)[0] },
              { ...f, town: null },
            )
          }
          rows={rows}
        />
      ) : null}
      {nothingSoon && !filtered(f) ? <QuietWeek /> : null}

      <p className="text-center text-[0.95rem] leading-snug text-ink-soft">
        Plans change. Check the source before you go. Know an event we missed?{" "}
        <a href="mailto:hello@parkroulette.quest" className="underline">
          Email us
        </a>
        .
      </p>

      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "CollectionPage",
              name: "Kids' events in Bend and Central Oregon",
              url: `${SITE_URL}/events`,
              inLanguage: "en-US",
            },
            {
              "@type": "ItemList",
              itemListElement: live.slice(0, 30).map((x, n) => ({
                "@type": "ListItem",
                position: n + 1,
                url: `${SITE_URL}/events/${x.r.slug}`,
              })),
            },
            {
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
              ],
            },
          ],
        }}
      />
    </>
  );
}

function addDaysStr(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The Saturday of this weekend (if it's still ahead or today). */
function satOf(b: ReturnType<typeof groupBounds>): string | null {
  for (let i = 0; i < 3; i++) {
    const d = addDaysStr(b.weekend.from, i);
    if (new Date(`${d}T12:00:00Z`).getUTCDay() === 6 && d <= b.weekend.to)
      return d;
  }
  return null;
}

/** Plain links (no JavaScript): Town ▾ (a details list), Indoor, Outdoor, Free; ages. */
function FilterBar({ f, towns }: { f: Filters; towns: string[] }) {
  const chip = (on: boolean) =>
    `chip min-h-11 justify-center ${on ? "bg-ink! text-paper!" : ""}`;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <details className="relative">
          <summary className={`${chip(!!f.town)} cursor-pointer list-none`}>
            {f.town
              ? (towns.find((t) => townSlug(t) === f.town) ?? "Town")
              : "Town"}{" "}
            ▾
          </summary>
          <ul className="doodle-box absolute z-20 mt-1 flex min-w-44 flex-col bg-paper px-2 py-1">
            <li>
              <Link
                href={href({ ...f, town: null })}
                className="flex min-h-11 items-center px-2 underline"
                aria-current={!f.town ? "true" : undefined}
              >
                All towns
              </Link>
            </li>
            {towns.map((t) => (
              <li key={t}>
                <Link
                  href={href({ ...f, town: townSlug(t) })}
                  className="flex min-h-11 items-center px-2 underline"
                  aria-current={f.town === townSlug(t) ? "true" : undefined}
                >
                  {t}
                </Link>
              </li>
            ))}
          </ul>
        </details>
        {(["indoor", "outdoor"] as const).map((s) => (
          <Link
            key={s}
            href={href({ ...f, setting: f.setting === s ? null : s })}
            className={chip(f.setting === s)}
            aria-current={f.setting === s ? "true" : undefined}
          >
            {s === "indoor" ? "Indoor" : "Outdoor"}
          </Link>
        ))}
        <Link
          href={href({ ...f, free: !f.free })}
          className={chip(f.free)}
          aria-current={f.free ? "true" : undefined}
        >
          Free
        </Link>
      </div>
      <div className="flex flex-wrap items-center gap-2" aria-label="Ages">
        {AGE_BRACKETS.map((b) => (
          <Link
            key={b.key}
            href={href({ ...f, age: f.age === b.key ? null : b.key })}
            className={chip(f.age === b.key)}
            aria-current={f.age === b.key ? "true" : undefined}
          >
            {b.tag}
          </Link>
        ))}
      </div>
    </div>
  );
}

/** A filter that finds nothing: the narrowest undo, and the nearest matches. */
function FilterEmpty({
  f,
  live,
  pass,
  rows,
}: {
  f: Filters;
  live: EventRow[];
  pass: (r: EventRow) => boolean;
  rows: EventRow[];
}) {
  const what = describe({ ...f, town: null }, rows).replace(
    /^Everything$/,
    "Nothing",
  );
  const where = f.town ? ` in ${townName(f.town, rows)}` : "";
  const line =
    what === "Nothing"
      ? `Nothing${where} yet.`
      : `Nothing ${what.toLowerCase()}${where} yet.`;
  // The nearest town with matches, by its events' distance from this town's.
  const here = live.find((r) => townSlug(r.data.venue.town) === f.town)?.data
    .point;
  const others = f.town
    ? Object.entries(
        live
          .filter((r) => townSlug(r.data.venue.town) !== f.town && pass(r))
          .reduce<Record<string, EventRow[]>>((m, r) => {
            (m[r.data.venue.town] ??= []).push(r);
            return m;
          }, {}),
      )
        .map(([town, rs]) => ({
          town,
          n: rs.length,
          mi:
            here && rs[0].data.point
              ? Math.round(milesBetween(here, rs[0].data.point))
              : null,
        }))
        .sort((a, b) => (a.mi ?? 999) - (b.mi ?? 999))
        .slice(0, 1)
    : [];
  return (
    <div className="doodle-box flex flex-col items-center gap-3 px-4 py-6 text-center">
      <Icon name="search" size={48} />
      <p className="font-hand text-2xl">{line}</p>
      <Link
        href={f.town ? href({ ...f, town: null }) : "/events"}
        className="crayon-btn wax min-h-12 bg-crayon-yellow px-5 text-xl"
      >
        {f.town ? "Show all towns" : "Show everything"}
      </Link>
      {others.map((o) => (
        <p key={o.town} className="leading-snug">
          <Link
            href={href({ ...f, town: townSlug(o.town) })}
            className="underline"
          >
            {describe({ ...f, town: null }, rows).replace(
              /^Everything$/,
              "Events",
            )}{" "}
            in {o.town}
            {o.mi != null ? `, ${o.mi} miles away` : ""}: {o.n}{" "}
            {o.n === 1 ? "event" : "events"}
          </Link>
        </p>
      ))}
    </div>
  );
}

/** Nothing in the next 14 days: a doodle, a line, a spin, and indoor backups. */
function QuietWeek() {
  const backups = CATALOG.venues
    .filter((v) => v.verified && v.covered)
    .slice(0, 3);
  return (
    <section className="doodle-box flex flex-col items-center gap-3 px-4 py-6 text-center">
      <Icon name="sun" size={56} />
      <h2 className="font-hand text-3xl">Quiet week out there.</h2>
      <p className="leading-snug">
        We haven&apos;t found any kids&apos; events for the next two weeks.
        There&apos;s always a playground, though.
      </p>
      <Link
        href="/"
        className="crayon-btn wax min-h-12 bg-crayon-yellow px-5 text-xl"
      >
        Spin the wheel
      </Link>
      {backups.length ? (
        <div className="flex w-full flex-col gap-1 text-left">
          <h3 className="font-hand text-2xl">Indoor backups</h3>
          <ul className="flex flex-col divide-y divide-dashed divide-ink/20">
            {backups.map((v) => (
              <li key={v.id} className="py-2">
                <a href={v.url} className="underline">
                  {v.name}
                </a>
                <span className="text-ink-soft">, {v.town}</span>
                <span className="sr-only"> (opens the official site)</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
