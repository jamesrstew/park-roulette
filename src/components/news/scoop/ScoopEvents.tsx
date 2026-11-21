import Link from "next/link";
import { Chip } from "@/components/events/EventBits";
import { Icon } from "@/components/icons";
import type { ScoopEvent } from "@/lib/scoop";
import { Carousel } from "./Carousel";

/** Card size, shared with the skeleton so nothing moves when it streams. */
export const CARD = "h-[9.5rem] w-[16.25rem] shrink-0";

/** The block's heading row: "Kids' events" and See all. */
export function EventsHeading() {
  return (
    <div className="flex items-end justify-between gap-3">
      <h2 id="scoop-events-h" className="font-hand text-2xl leading-none">
        Kids&apos; events
      </h2>
      <Link
        href="/events"
        data-scoop="all_events"
        className="flex min-h-11 shrink-0 items-end pb-0.5 underline underline-offset-2"
      >
        See all
      </Link>
    </div>
  );
}

/**
 * The soonest kids' events as a swipe row: title, when, town, one age chip
 * and Free. Each card is one link with a full name for screen readers. The
 * last card says See all events.
 */
export function ScoopEvents({ events }: { events: ScoopEvent[] }) {
  if (!events.length)
    return (
      <div className="doodle-box-alt flex h-[9.5rem] items-center gap-3 p-4">
        <Icon name="calendar" size={40} />
        <div className="flex-1 leading-snug">
          <p className="font-hand text-xl">
            A quiet week for kids&apos; events.
          </p>
          <Link
            href="/events"
            data-scoop="all_events"
            className="crayon-btn wax mt-1 min-h-11 bg-crayon-green px-4 text-lg text-white [text-shadow:1px_1px_0_#2b2a33]"
          >
            See what&apos;s later
          </Link>
        </div>
      </div>
    );
  return (
    <Carousel id="scoop-events" label="Upcoming kids' events">
      {events.map((e, i) => (
        <li key={e.slug} className={`${CARD} relative snap-start`}>
          {e.regular ? (
            <span className="absolute top-1 right-2 z-10 -rotate-3 rounded-[var(--radius-wobbly-2)] border-2 border-ink bg-[color-mix(in_srgb,var(--color-crayon-teal)_22%,#fffdf7)] px-1.5 font-hand text-sm leading-tight">
              Regular
            </span>
          ) : null}
          <Link
            href={e.href}
            data-scoop="event"
            aria-label={[
              e.title,
              e.regular ? "a regular" : null,
              e.when.replace(" · ", " at "),
              e.town,
              e.age,
              e.free ? "Free" : null,
            ]
              .filter(Boolean)
              .join(", ")}
            className={`${i % 2 ? "doodle-box-alt" : "doodle-box"} flex h-full flex-col gap-1 px-3.5 py-3 transition-transform active:scale-[0.98]`}
          >
            <p className="font-hand text-[1.05rem] leading-none text-ink-soft">
              {e.when}
            </p>
            <p className="line-clamp-2 font-hand text-[1.3rem] leading-[1.1]">
              {e.title}
            </p>
            <p className="flex items-center gap-1 truncate text-sm text-ink-soft">
              <Icon name="pin" size={16} className="shrink-0" />
              {e.town}
            </p>
            <div className="mt-auto flex flex-wrap gap-1.5">
              {e.free ? <Chip tint="free">Free</Chip> : null}
              {e.age ? <Chip tint="age">{e.age}</Chip> : null}
            </div>
          </Link>
        </li>
      ))}
      <li className={`${CARD} snap-start`}>
        <Link
          href="/events"
          data-scoop="all_events"
          className="doodle-box flex h-full flex-col items-center justify-center gap-2 bg-[color-mix(in_srgb,var(--color-crayon-green)_14%,#fffdf7)] p-4 text-center transition-transform active:scale-[0.98]"
        >
          <Icon name="calendar" size={44} />
          <span className="font-hand text-2xl leading-tight underline underline-offset-4">
            See all events
          </span>
        </Link>
      </li>
    </Carousel>
  );
}
