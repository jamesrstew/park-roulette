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
  ...new Set(p.branches.flatMap((b) => b.row.data.ages?.tags ?? [])),
];
const allFree = (p: Program) => p.branches.every((b) => isFree(b.row.data));
const canceled = (b: Branch) => b.row.status === "canceled";

/** "Through Jan 4", "4 shows through Nov 29", "+2 more dates", or null. */
function moreLine(p: Program, today: string): string | null {
  const d = p.lead.next;
  if (d.end_day && d.end_day !== d.day)
    return d.day < today ? `Through ${monthDay(d.end_day)}` : null;
  const venues = new Set(p.branches.map((b) => b.row.data.venue.name));
  const dates = p.branches.flatMap((b) => b.upcoming);
  if (venues.size > 1 || dates.length < 2) return null;
  const days = dates.map((x) => x.day).sort();
  const last = days[days.length - 1];
  return last === days[0]
    ? `${dates.length} sessions`
    : `${dates.length} dates through ${monthDay(last)}`;
}

/** Other branches of a special, each linked: "Also Sisters Dec 2 · Redmond Jan 13". */
function AlsoAt({ p, today }: { p: Program; today: string }) {
  const rest = p.branches.slice(1);
  if (!rest.length) return null;
  return (
    <p className="relative z-10 text-[0.95rem] leading-snug">
      Also{" "}
      {rest.map((b, i) => (
        <span key={b.row.id}>
          {i ? " · " : ""}
          <Link href={`/events/${b.row.slug}`} className="underline">
            {b.row.data.venue.town}
          </Link>{" "}
          {b.next.day <= addDays(today, 1)
            ? dayWord(b.next.day, today)
            : monthDay(b.next.day)}
        </span>
      ))}
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
  const { row, next } = p.lead;
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
      <h3 className="font-hand text-2xl leading-tight">
        <Link
          href={`/events/${row.slug}`}
          className="underline decoration-2 underline-offset-4 after:absolute after:inset-0 after:content-['']"
        >
          {p.title}
        </Link>
      </h3>
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
  const { row, next } = p.lead;
  const [, m, d] = p.day.split("-").map(Number);
  const age = ageChip(tagsOf(p));
  const multi = p.branches.length > 1;
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
        <h3 className="font-hand text-xl leading-tight">
          <Link
            href={`/events/${row.slug}`}
            className="underline decoration-2 underline-offset-4 after:absolute after:inset-0 after:content-['']"
          >
            {p.title}
          </Link>
        </h3>
        <p className="text-[0.95rem] leading-snug text-ink-soft">
          <time dateTime={next.start ? `${next.day}T${next.start}` : next.day}>
            {canceled(p.lead) ? (
              <s>{nextLine(next, today)}</s>
            ) : (
              nextLine(next, today)
            )}
          </time>
          {" · "}
          {multi ? placesLabel(p.branches) : venueLine(row)}
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
        {multi ? <AlsoAt p={p} today={today} /> : null}
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
  const next = `Next: ${nextLine(p.lead.next, today)}${multi ? `, ${p.lead.row.data.venue.name}` : ""}`;
  const body = (
    <>
      <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-hand text-xl leading-tight underline decoration-2 underline-offset-4">
          {p.title}
        </span>
        {allFree(p) ? <Chip tint="free">Free</Chip> : null}
        {age ? <Chip tint="age">{age}</Chip> : null}
      </span>
      <span className="text-[0.95rem] leading-snug">
        {placesLabel(p.branches)}
        {pattern ? ` · ${pattern}` : ""}
      </span>
      <span className="text-sm leading-snug text-ink-soft">{next}</span>
    </>
  );
  if (!multi)
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
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">{body}</span>
          <span
            aria-hidden
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-wobbly-2)] border-2 border-ink bg-paper font-hand text-2xl transition-transform group-open:rotate-180"
          >
            ▾
          </span>
        </summary>
        <ul className="mb-2 ml-1 flex flex-col border-l-2 border-dashed border-ink/30 pl-3">
          {p.branches.map((b) => (
            <li key={b.row.id}>
              <Link
                href={`/events/${b.row.slug}`}
                className="flex min-h-11 flex-col justify-center py-1.5"
              >
                <span className="underline underline-offset-2">
                  {venueLine(b.row)}
                </span>
                <span className="text-sm text-ink-soft">
                  {patternLine(b.upcoming, today)} · Next{" "}
                  {nextLine(b.next, today).replace(/^To/, "to")}
                </span>
              </Link>
            </li>
          ))}
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
