import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import {
  NoSpecials,
  RegularRow,
  SpecialCard,
  SpecialRow,
  slugsOf,
} from "@/components/events/ProgramBits";
import {
  AllHidden,
  HiddenLine,
  LiveCount,
  MoreLabel,
  PrefsMarks,
  SavedLink,
} from "@/components/events/SaveHide";
import { ScrollToHash } from "@/components/events/ScrollToHash";
import { Icon } from "@/components/icons";
import { CrayonLoading } from "@/components/Loading";
import { PageTitle } from "@/components/PageTitle";
import { JsonLd } from "@/components/seo/JsonLd";
import { AGE_BRACKETS, type AgeKey, matchesAge } from "@/lib/events/ages";
import { townForecast, weatherFor } from "@/lib/events/forecast";
import {
  type EventRow,
  groupBounds,
  isFree,
  monthDay,
  pacificToday,
  shortDate,
} from "@/lib/events/model";
import {
  bigFirst,
  buildPrograms,
  groupSpan,
  narrowPrograms,
  onDay,
  SPECIAL_GROUP_NAMES,
  type SpecialGroup,
  specialGroupOf,
  inSpan,
  weekView,
} from "@/lib/events/programs";
import { allEvents } from "@/lib/events/store";
import { CATALOG } from "@/lib/news/catalog";
import { publicParks } from "@/lib/seo-data";
import { guidePath } from "@/lib/guides";
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
  /** ?week=<day>: seven days from that day (the Tuesday roundup's link). */
  week: string | null;
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
    week: /^\d{4}-\d{2}-\d{2}$/.test(one("week")) ? one("week") : null,
  };
}

/** One view, one URL: town, setting, free, age, always in that order. */
function href(f: Filters): string {
  const q = new URLSearchParams();
  if (f.town) q.set("town", f.town);
  if (f.setting) q.set("setting", f.setting);
  if (f.free) q.set("free", "1");
  if (f.age) q.set("age", f.age);
  if (f.week) q.set("week", f.week);
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
      "Upcoming kid-friendly events in Bend, Redmond, Sisters and beyond, each linked to its own page, with indoor picks and playgrounds nearby.",
    // Every filter canonicalizes to the listing (never also noindex).
    alternates: { canonical: "/events" },
  };
}

export default function EventsPage(props: Props) {
  return (
    <div className="flex flex-col gap-5">
      <div className="-mb-3 flex items-center justify-between gap-2">
        <nav aria-label="Breadcrumb" className="text-sm text-ink-soft">
          <Link href="/" className="underline">
            Park Roulette
          </Link>{" "}
          › Kids&apos; events
        </nav>
        <SavedLink />
      </div>
      <PageTitle
        lead="Kids'"
        accent="events"
        color="green"
        underline="yellow"
        underlineWidth="w-40"
        subtitle={
          <p className="text-lg">
            Big days out first. Story times and clubs below.
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
  const asked = readFilters(await searchParams);
  // ?week= (the Tuesday roundup's link): that week's days, from today on.
  // A week that's over shows what's on now, says so, and leaves the
  // filter links (as does one that isn't a real week).
  const wk = asked.week ? weekView(asked.week, today) : null;
  const f: Filters = wk && !wk.over ? asked : { ...asked, week: null };
  const [rows, parks] = await Promise.all([allEvents(), publicParks()]);
  const pass = (r: EventRow, g: Filters) =>
    (!g.town || townSlug(r.data.venue.town) === g.town) &&
    (!g.setting || r.data.setting === g.setting) &&
    (!g.free || isFree(r.data)) &&
    (!g.age || matchesAge(r.data.ages?.tags ?? [], g.age));
  const everything = buildPrograms(rows, now);
  // Built once; a filter narrows each program's rows (its kind stays).
  const narrowed = filtered(f)
    ? narrowPrograms(everything, (r) => pass(r, f), today)
    : everything;
  const programs = wk && !wk.over ? inSpan(narrowed, wk.from, wk.to) : narrowed;
  const specials = programs.filter((p) => p.kind === "special");
  const regulars = programs.filter((p) => p.kind === "regular");
  const groups = (["today", "weekend", "later"] as SpecialGroup[])
    .map((k) => ({
      k,
      span: groupSpan(k, today),
      items: specials
        .filter((p) => specialGroupOf(p.day, today) === k)
        .sort(k === "later" ? () => 0 : bigFirst),
    }))
    .filter((g) => g.span);
  // A hide covers a program's every page, even when a filter shows fewer.
  const pagesOf = new Map(everything.map((p) => [p.key, slugsOf(p)]));
  const sl = (p: (typeof programs)[number]) => pagesOf.get(p.key) ?? slugsOf(p);
  const liveRows = everything.flatMap((p) => p.branches.flatMap((b) => b.rows));
  const towns = [...new Set(liveRows.map((r) => r.data.venue.town))].sort();

  // The weather strip: Saturday in Bend, and how many indoor picks.
  const bounds = groupBounds(today);
  // Programs with an indoor date this weekend (what the indoor link shows).
  const weekendFrom = bounds.weekend.from > today ? bounds.weekend.from : today;
  const indoor = narrowPrograms(
    programs,
    (r) => r.data.setting === "indoor",
    today,
  ).filter((p) => {
    for (let d = weekendFrom; d <= bounds.weekend.to; d = addDaysStr(d, 1))
      if (onDay(p, d)) return true;
    return false;
  }).length;
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

  /** Regulars on a day range, by name (for the honest empty lines). */
  const regularsOn = (from: string, to: string) =>
    regulars
      .filter((p) => {
        for (let d = from; d <= to; d = addDaysStr(d, 1))
          if (onDay(p, d)) return true;
        return false;
      })
      .map((p) => p.title);
  const LATER_SHOWN = 12;
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
              {indoor} indoor {indoor === 1 ? "thing" : "things"} to do this
              weekend
            </Link>
          </span>
        </p>
      ) : null}

      <FilterBar f={f} towns={towns} />
      {wk ? (
        <p className="-mt-2 leading-snug" role="status">
          {wk.over
            ? `The week of ${monthDay(wk.start)} is over. Here's what's on now.`
            : `From our roundup: ${monthDay(wk.start)} to ${monthDay(wk.to)}.`}{" "}
          {wk.over ? null : (
            <Link href={href({ ...f, week: null })} className="underline">
              See every week
            </Link>
          )}
        </p>
      ) : null}
      {filtered(f) ? (
        <p className="-mt-2 leading-snug">
          {describe(f, rows)}: {specials.length} special{" "}
          {specials.length === 1 ? "event" : "events"}, {regulars.length}{" "}
          {regulars.length === 1 ? "regular" : "regulars"}.{" "}
          <Link href="/events" className="underline">
            Show all
          </Link>
        </p>
      ) : null}

      {programs.length ? (
        <nav
          aria-label="On this page"
          className="-mt-2 flex flex-wrap items-center gap-x-3 text-ink-soft"
        >
          Jump to:
          <a
            href="#specials"
            className="flex min-h-11 items-center text-ink underline underline-offset-2"
          >
            Specials (<LiveCount programs={specials.map(sl)} />)
          </a>
          ·
          <a
            href="#regulars"
            className="flex min-h-11 items-center text-ink underline underline-offset-2"
          >
            Regulars (<LiveCount programs={regulars.map(sl)} />)
          </a>
        </nav>
      ) : null}

      {programs.length ? (
        <section
          id="specials"
          aria-labelledby="specials-h"
          className="flex scroll-mt-4 flex-col gap-4"
        >
          <h2 id="specials-h" className="sr-only">
            Special events
          </h2>
          {!specials.length ? (
            <div className="doodle-box flex flex-col items-center gap-3 px-4 py-6 text-center">
              <Icon name="calendar" size={48} />
              <p className="font-hand text-2xl">
                {wk && !wk.over
                  ? "No special events that week yet."
                  : filtered(f)
                    ? "No special events for these filters yet."
                    : "No special events in the next two months yet."}
              </p>
              <Link
                href="#regulars"
                className="crayon-btn wax min-h-12 bg-crayon-yellow px-5 text-xl"
              >
                See the regulars
              </Link>
            </div>
          ) : null}
          {(specials.length ? groups : []).map((g) => {
            const big = g.k !== "later";
            const head = g.items.slice(0, big ? 6 : LATER_SHOWN);
            const tail = g.items.slice(head.length);
            const span = g.span!;
            const on =
              g.k === "later" || g.items.length
                ? []
                : regularsOn(span.from, span.to);
            return (
              <section
                key={g.k}
                aria-labelledby={`g-${g.k}`}
                className="flex flex-col gap-3"
                data-ev-group={g.items.length ? "" : undefined}
              >
                <h3 id={`g-${g.k}`} className="font-hand text-3xl">
                  {SPECIAL_GROUP_NAMES[g.k]}{" "}
                  <span className="text-lg text-ink-soft">
                    {span.from === span.to
                      ? shortDate(span.from)
                      : g.k === "later"
                        ? `through ${monthDay(span.to)}`
                        : `${monthDay(span.from)} to ${monthDay(span.to)}`}
                  </span>
                </h3>
                {!g.items.length && g.k !== "later" ? (
                  <NoSpecials
                    line={
                      g.k === "today"
                        ? "Nothing special today."
                        : "No special events this weekend yet."
                    }
                    regulars={on}
                    fallback={
                      g.k === "today" &&
                      groups.some((x) => x.k === "weekend" && x.items.length)
                        ? {
                            href: "#g-weekend",
                            label: "See this weekend's special events",
                          }
                        : groups.some((x) => x.k === "later" && x.items.length)
                          ? { href: "#g-later", label: "See what's coming up" }
                          : { href: "/", label: "Spin for a playground" }
                    }
                    regularsLabel={
                      g.k === "today"
                        ? `${on.length} ${on.length === 1 ? "regular is" : "regulars are"} on today`
                        : `${on.length} ${on.length === 1 ? "regular" : "regulars"} this weekend`
                    }
                  />
                ) : null}
                {g.items.length ? <AllHidden /> : null}
                {!g.items.length && g.k === "later" ? (
                  <p className="leading-snug text-ink-soft">
                    Nothing else special on the calendar yet.
                  </p>
                ) : null}
                {big ? (
                  <>
                    {head.map((p) => (
                      <SpecialCard
                        key={p.key}
                        p={p}
                        today={today}
                        parks={parks}
                        slugs={sl(p)}
                      />
                    ))}
                    {tail.length ? (
                      <ul
                        data-ev-box
                        className="doodle-box flex flex-col divide-y divide-dashed divide-ink/25 px-3"
                      >
                        {tail.map((p) => (
                          <SpecialRow
                            key={p.key}
                            p={p}
                            today={today}
                            slugs={sl(p)}
                          />
                        ))}
                      </ul>
                    ) : null}
                  </>
                ) : g.items.length ? (
                  <div className="doodle-box px-3" data-ev-box>
                    <ul className="flex flex-col divide-y divide-dashed divide-ink/25">
                      {head.map((p) => (
                        <SpecialRow
                          key={p.key}
                          p={p}
                          today={today}
                          slugs={sl(p)}
                        />
                      ))}
                    </ul>
                    {tail.length ? (
                      <details
                        data-ev-box
                        className="group border-t border-dashed border-ink/25"
                      >
                        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-center gap-2 font-hand text-xl underline underline-offset-4 [&::-webkit-details-marker]:hidden">
                          <span className="group-open:hidden">
                            <MoreLabel programs={tail.map(sl)} /> ▾
                          </span>
                          <span className="hidden group-open:inline">
                            Show fewer ▴
                          </span>
                        </summary>
                        <ul className="flex flex-col divide-y divide-dashed divide-ink/25">
                          {tail.map((p) => (
                            <SpecialRow
                              key={p.key}
                              p={p}
                              today={today}
                              slugs={sl(p)}
                            />
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </div>
                ) : null}
              </section>
            );
          })}
          <HiddenLine programs={specials.map(sl)} where="Specials" />
        </section>
      ) : null}

      {programs.length ? (
        <section
          id="regulars"
          data-ev-group={regulars.length ? "" : undefined}
          aria-labelledby="regulars-h"
          className="flex scroll-mt-4 flex-col gap-1 rounded-[var(--radius-wobbly)] border-2 border-dashed border-ink/40 bg-[color-mix(in_srgb,var(--color-crayon-teal)_10%,#fffdf7)] px-4 py-4"
        >
          <h2 id="regulars-h" className="font-hand text-3xl">
            Regulars
          </h2>
          <p className="leading-snug text-ink-soft">
            Story times, clubs and classes that come around again.
          </p>
          {regulars.length ? (
            <ul
              data-ev-box
              className="mt-1 flex flex-col divide-y divide-dashed divide-ink/25"
            >
              {regulars.map((p) => (
                <RegularRow key={p.key} p={p} today={today} slugs={sl(p)} />
              ))}
            </ul>
          ) : (
            <p className="py-2 leading-snug">
              No regulars for these filters.{" "}
              <Link href="/events" className="underline">
                Show everything
              </Link>
            </p>
          )}
          {regulars.length ? <AllHidden /> : null}
          <HiddenLine programs={regulars.map(sl)} where="Regulars" />
        </section>
      ) : null}

      {!programs.length && filtered(f) ? (
        <FilterEmpty
          f={f}
          live={liveRows}
          pass={(r) => pass(r, { ...f, town: null })}
          rows={rows}
        />
      ) : null}
      {!programs.length && !filtered(f) ? <QuietWeek /> : null}

      <p className="text-center text-[0.95rem] leading-snug text-ink-soft">
        Plans change. Check the source before you go. Know an event we missed?{" "}
        <a href="mailto:hello@parkroulette.quest" className="underline">
          Email us
        </a>
        .
      </p>

      <p className="text-center text-[0.95rem] leading-snug">
        Guides:{" "}
        <Link
          href={guidePath("holiday-events-central-oregon")}
          className="underline"
        >
          Holiday events this year
        </Link>
        {" · "}
        <Link href={guidePath("indoor-play-bend")} className="underline">
          Indoor play when it snows
        </Link>
        {" · "}
        <Link href="/guides" className="underline">
          All guides
        </Link>
      </p>

      <PrefsMarks />
      <ScrollToHash />
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
              // Specials first (each branch its own page), then regulars.
              itemListElement: [
                ...everything.filter((p) => p.kind === "special"),
                ...everything.filter((p) => p.kind === "regular"),
              ]
                .flatMap((p) =>
                  p.branches.flatMap((b) => b.rows.map((r) => r.slug)),
                )
                .slice(0, 30)
                .map((slug, n) => ({
                  "@type": "ListItem",
                  position: n + 1,
                  url: `${SITE_URL}/events/${slug}`,
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
