import Link from "next/link";
import { Chip, EventChips } from "@/components/events/EventBits";
import { Icon } from "@/components/icons";
import type { AgeTag } from "@/lib/events/ages";
import { closestLine, type NearPark } from "@/lib/events/nearby";
import { isFree, monthDay } from "@/lib/events/model";
import { addDays } from "@/lib/news/time";
import {
  type Branch,
  dayWord,
  nextLine,
  patternLine,
  placesLabel,
  type Program,
  venueLine,
} from "@/lib/events/programs";
import { ageChip } from "@/lib/scoop";

/**
 * /events, by program: big cards for today's and this weekend's specials,
 * compact rows for the rest, and one calm row per regular. Every event
 * page stays linked from the listing (other branches as their own links).
 */

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const tagsOf = (p: Program): AgeTag[] => [
  ...new Set(
    p.branches.flatMap((b) => b.rows.flatMap((r) => r.data.ages?.tags ?? [])),
  ),
];
const allFree = (p: Program) =>
  p.branches.every((b) => b.rows.every((r) => isFree(r.data)));
const canceled = (b: Branch) => b.nextRow.status === "canceled";

/** "Through Jan 4", "4 dates through Nov 29", "2 sessions", or null. */
function moreLine(p: Program, today: string): string | null {
  const d = p.lead.next;
  if (d.end_day && d.end_day !== d.day)
    return d.day < today ? `Through ${monthDay(d.end_day)}` : null;
  if (p.branches.length > 1) return null;
  const days = p.lead.upcoming.map((x) => x.day);
  if (days.length < 2) return null;
  const last = days[days.length - 1];
  return last === days[0]
    ? `${days.length} sessions`
    : `${days.length} dates through ${monthDay(last)}`;
}

/**
 * The program's other event pages, each linked, so every page stays
 * reachable from the listing: "Also Sisters Library, Dec 2".
 */
function AlsoAt({ p, today }: { p: Program; today: string }) {
  const lead = p.lead.nextRow;
  const rest = p.branches.flatMap((b) =>
    b.parts
      .filter((x) => x.row.id !== lead.id && x.upcoming.length)
      .map((x) => ({ ...x, branch: b })),
  );
  if (!rest.length) return null;
  return (
    <p className="relative z-10 text-[0.95rem] leading-snug">
      Also{" "}
      {rest.map((x, i) => {
        const sameVenue = x.branch === p.lead;
        const sameTitle = x.row.data.title === p.title;
        const label = [
          sameTitle ? null : x.row.data.title,
          sameVenue ? null : venueLine(x.row),
        ]
          .filter(Boolean)
          .join(", ");
        const when =
          x.upcoming[0].day <= addDays(today, 1)
            ? dayWord(x.upcoming[0].day, today)
            : monthDay(x.upcoming[0].day);
        return (
          <span key={x.row.id}>
            {i ? " · " : ""}
            <Link href={`/events/${x.row.slug}`} className="underline">
              {label || when}
            </Link>
            {label ? `, ${when}` : ""}
          </span>
        );
      })}
    </p>
  );
}

/** A special happening today or this weekend: big, with a day tape. */
export function SpecialCard({
  p,
  today,
  parks,
}: {
  p: Program;
  today: string;
  parks: readonly NearPark[];
}) {
  const { nextRow: row, next } = p.lead;
  const near = closestLine(row.data, parks);
  const more = moreLine(p, today);
  return (
    <article
      className={`${p.annual ? "doodle-box-alt" : "doodle-box"} relative mt-2 flex flex-col gap-1.5 px-4 pt-5 pb-3 focus-within:ring-4 focus-within:ring-crayon-blue/40`}
    >
      <span
        className={`absolute -top-3 left-3 -rotate-2 rounded-[var(--radius-wobbly-2)] border-2 border-ink px-2 py-0.5 font-hand text-lg leading-tight shadow-[2px_2px_0_var(--color-ink)] ${p.annual ? "bg-crayon-pink text-paper" : "bg-crayon-yellow"}`}
      >
        <time dateTime={next.start ? `${next.day}T${next.start}` : next.day}>
          {canceled(p.lead) ? (
            <s>{nextLine(next, today)}</s>
          ) : (
            nextLine(next, today)
          )}
        </time>
      </span>
      <h4 className="font-hand text-2xl leading-tight">
        <Link
          href={`/events/${row.slug}`}
          className="underline decoration-2 underline-offset-4 after:absolute after:inset-0 after:content-['']"
        >
          {p.title}
        </Link>
      </h4>
      <p className="text-[0.95rem] text-ink-soft">
        {venueLine(row)}
        {more ? ` · ${more}` : ""}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {p.annual ? <Chip tint="free">Once a year</Chip> : null}
        <EventChips row={row} />
      </div>
      <p className="line-clamp-2 leading-snug">{row.data.what}</p>
      {near ? (
        <p className="text-[0.95rem]" aria-label={near.label}>
          {near.text}
        </p>
      ) : null}
      <AlsoAt p={p} today={today} />
    </article>
  );
}

/** A special further out: a date block, the title, where, a few chips. */
export function SpecialRow({ p, today }: { p: Program; today: string }) {
  const { nextRow: row, next } = p.lead;
  const [, m, d] = p.day.split("-").map(Number);
  const age = ageChip(tagsOf(p));
  const more = moreLine(p, today);
  return (
    <li className="relative flex gap-3 py-3 focus-within:ring-4 focus-within:ring-crayon-blue/40">
      <span
        aria-hidden
        className={`flex h-14 w-12 shrink-0 flex-col items-center justify-center rounded-[var(--radius-wobbly-2)] border-2 border-ink font-hand leading-none ${p.annual ? "bg-crayon-pink text-paper" : "bg-[color-mix(in_srgb,var(--color-crayon-yellow)_45%,#fffdf7)]"}`}
      >
        <span className="text-sm uppercase">{MONTHS[m - 1]}</span>
        <span className="text-2xl">{d}</span>
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h4 className="font-hand text-xl leading-tight">
          <Link
            href={`/events/${row.slug}`}
            className="underline decoration-2 underline-offset-4 after:absolute after:inset-0 after:content-['']"
          >
            {p.title}
          </Link>
        </h4>
        <p className="text-[0.95rem] leading-snug text-ink-soft">
          <time dateTime={next.start ? `${next.day}T${next.start}` : next.day}>
            {canceled(p.lead) ? (
              <s>{nextLine(next, today)}</s>
            ) : (
              nextLine(next, today)
            )}
          </time>
          {" · "}
          {placesLabel(p.branches)}
          {more ? ` · ${more}` : ""}
        </p>
        {p.annual || age || allFree(p) || row.status !== "scheduled" ? (
          <div className="flex flex-wrap gap-1.5">
            {row.status === "canceled" ? <Chip>Canceled</Chip> : null}
            {row.status === "postponed" ? <Chip>Postponed</Chip> : null}
            {p.annual ? <Chip tint="free">Once a year</Chip> : null}
            {allFree(p) ? <Chip tint="free">Free</Chip> : null}
            {age ? <Chip tint="age">{age}</Chip> : null}
          </div>
        ) : null}
        <AlsoAt p={p} today={today} />
      </div>
    </li>
  );
}

/** A regular, once: what, where, when it usually is, and the next one. */
export function RegularRow({ p, today }: { p: Program; today: string }) {
  const age = ageChip(tagsOf(p));
  const dates = p.branches.flatMap((b) => b.upcoming);
  const pattern = patternLine(
    dates,
    today,
    p.branches.map((b) => b.upcoming),
  );
  const multi = p.branches.length > 1;
  // Every event page gets a link: a branch's rows (a series and a one-off).
  const pages = p.branches.flatMap((b) =>
    b.parts.filter((x) => x.upcoming.length).map((x) => ({ ...x, b })),
  );
  const next = `Next: ${nextLine(p.lead.next, today)}${multi ? `, ${p.lead.row.data.venue.name}` : ""}`;
  const body = (
    <>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className="font-hand text-xl leading-tight underline decoration-2 underline-offset-4">
          {p.title}
        </h3>
        {allFree(p) ? <Chip tint="free">Free</Chip> : null}
        {age ? <Chip tint="age">{age}</Chip> : null}
      </div>
      <span className="text-[0.95rem] leading-snug">
        {placesLabel(p.branches)}
        {pattern ? ` · ${pattern}` : ""}
      </span>
      <span className="text-sm leading-snug text-ink-soft">{next}</span>
    </>
  );
  if (pages.length === 1)
    return (
      <li>
        <Link
          href={`/events/${p.lead.row.slug}`}
          className="flex min-h-11 flex-col gap-0.5 py-2.5"
        >
          {body}
        </Link>
      </li>
    );
  return (
    <li>
      <details className="group">
        <summary className="flex min-h-11 cursor-pointer list-none items-start gap-2 py-2.5 [&::-webkit-details-marker]:hidden">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">{body}</div>
          <span
            aria-hidden
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-wobbly-2)] border-2 border-ink bg-paper font-hand text-2xl transition-transform group-open:rotate-180"
          >
            ▾
          </span>
        </summary>
        <ul className="mb-2 ml-1 flex flex-col border-l-2 border-dashed border-ink/30 pl-3">
          {pages.map((x) => {
            const own = x.row.data.title !== p.title ? x.row.data.title : null;
            const line = patternLine(x.upcoming, today);
            return (
              <li key={x.row.id}>
                <Link
                  href={`/events/${x.row.slug}`}
                  className="flex min-h-11 flex-col justify-center py-1.5"
                >
                  <span className="underline underline-offset-2">
                    {own ? `${own}, ` : ""}
                    {venueLine(x.row)}
                  </span>
                  <span className="text-sm text-ink-soft">
                    {line ? `${line} · ` : ""}Next{" "}
                    {nextLine(x.upcoming[0], today).replace(/^To/, "to")}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </details>
    </li>
  );
}

/** "Nothing special today" with a way to today's regulars. */
export function NoSpecials({
  line,
  regulars,
  regularsLabel,
  fallback,
}: {
  line: string;
  regulars: string[];
  regularsLabel: string;
  /** The next action when no regulars are on either (never a dead end). */
  fallback: { href: string; label: string };
}) {
  return (
    <div className="flex items-start gap-2 rounded-2xl border-2 border-dashed border-ink/40 bg-white/50 px-3 py-2 leading-snug">
      <Icon name="calendar" size={26} className="mt-0.5 shrink-0" />
      <div className="flex flex-col">
        <span>{line}</span>
        {regulars.length ? (
          <Link
            href="#regulars"
            className="flex min-h-11 items-center underline underline-offset-2"
          >
            {regularsLabel}: {regulars.slice(0, 3).join(", ")}
            {regulars.length > 3 ? ` and ${regulars.length - 3} more` : ""}
          </Link>
        ) : (
          <Link
            href={fallback.href}
            className="flex min-h-11 items-center underline underline-offset-2"
          >
            {fallback.label}
          </Link>
        )}
      </div>
    </div>
  );
}
