import Link from "next/link";
import type { ReactNode } from "react";
import { closestLine, type NearPark } from "@/lib/events/nearby";
import {
  costChip,
  domainOf,
  type EventDate,
  type EventRow,
  whenLine,
} from "@/lib/events/model";

/**
 * Kids' events, shared bits: chips (text first, color only as decoration)
 * and the listing card (one card, one link: a stretched title link).
 */

const TINT = {
  indoor: "bg-[color-mix(in_srgb,var(--color-crayon-teal)_22%,#fffdf7)]",
  outdoor: "bg-[color-mix(in_srgb,var(--color-crayon-green)_20%,#fffdf7)]",
  free: "bg-[color-mix(in_srgb,var(--color-crayon-yellow)_45%,#fffdf7)]",
  cost: "bg-[color-mix(in_srgb,var(--color-crayon-orange)_22%,#fffdf7)]",
  age: "bg-[color-mix(in_srgb,var(--color-crayon-purple)_16%,#fffdf7)]",
  plain: "bg-paper",
} as const;

export function Chip({
  children,
  tint = "plain",
}: {
  children: ReactNode;
  tint?: keyof typeof TINT;
}) {
  return (
    <span
      className={`inline-flex min-h-7 items-center rounded-[var(--radius-wobbly-2)] border-2 border-ink px-2 font-hand text-base leading-tight ${TINT[tint]}`}
    >
      {children}
    </span>
  );
}

/** Indoor or Outdoor, Free or the price, age tags, Sign up first, Canceled. */
export function EventChips({ row }: { row: EventRow }) {
  const e = row.data;
  const cost = costChip(e);
  return (
    <div className="flex flex-wrap gap-1.5">
      {row.status === "canceled" ? <Chip tint="plain">Canceled</Chip> : null}
      {row.status === "postponed" ? <Chip tint="plain">Postponed</Chip> : null}
      {e.setting ? (
        <Chip tint={e.setting}>
          {e.setting === "indoor" ? "Indoor" : "Outdoor"}
        </Chip>
      ) : null}
      {cost ? (
        <Chip tint={cost === "Free" ? "free" : "cost"}>{cost}</Chip>
      ) : null}
      {(e.ages?.tags ?? []).map((t) => (
        <Chip key={t} tint="age">
          {t}
        </Chip>
      ))}
      {e.signup && e.signup.kind !== "none" ? <Chip>Sign up first</Chip> : null}
    </div>
  );
}

/** The date line, struck through (as decoration) when canceled. */
export function When({ d, canceled }: { d: EventDate; canceled?: boolean }) {
  const text = whenLine(d);
  return (
    <p className="font-hand text-lg leading-snug">
      <time dateTime={d.start ? `${d.day}T${d.start}` : d.day}>
        {canceled ? <s>{text}</s> : text}
      </time>
    </p>
  );
}

/** One event on /events: the whole card is one tap target. */
export function EventCard({
  row,
  next,
  parks,
  through,
}: {
  row: EventRow;
  next: EventDate;
  parks: readonly NearPark[];
  /** A multi-day event already on: "Through Jan 4." */
  through?: string | null;
}) {
  const e = row.data;
  const near = closestLine(e, parks);
  return (
    <article className="doodle-box relative flex flex-col gap-1.5 px-4 py-3 focus-within:ring-4 focus-within:ring-crayon-blue/40">
      <h3 className="font-hand text-2xl leading-tight">
        <Link
          href={`/events/${row.slug}`}
          className="underline decoration-2 underline-offset-4 after:absolute after:inset-0 after:content-['']"
        >
          {e.title}
        </Link>
      </h3>
      <When d={next} canceled={row.status === "canceled"} />
      {through ? <p className="text-sm">{through}</p> : null}
      <p className="text-[0.95rem] text-ink-soft">
        {e.venue.name}
        {e.venue.name.includes(e.venue.town) ? "" : `, ${e.venue.town}`}
      </p>
      <EventChips row={row} />
      <p className="leading-snug">{e.what}</p>
      {near ? (
        <p className="text-[0.95rem]" aria-label={near.label}>
          {near.text}
        </p>
      ) : null}
      <p className="text-sm text-ink-soft">From {domainOf(e.url)}</p>
    </article>
  );
}
