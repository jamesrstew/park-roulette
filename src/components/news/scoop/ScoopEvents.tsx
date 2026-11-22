import Link from "next/link";
import { Chip } from "@/components/events/EventBits";
import { Icon } from "@/components/icons";
import type { ScoopEvent } from "@/lib/scoop";
import { Carousel } from "./Carousel";

/** Card size, shared with the skeleton so nothing moves when it streams. */
export const CARD = "h-[13.5rem] w-[16.25rem] shrink-0";

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
 * The soonest kids' events as a swipe row: when, title, a one-liner of
 * what kids do (or where, when there's none), then where, price and ages
 * in a footer. Each card is one link with a full name for screen readers. The
 * last card says See all events.
 */
export function ScoopEvents({ events }: { events: ScoopEvent[] }) {
  if (!events.length)
    return (
      <div className="doodle-box-alt flex h-[13.5rem] items-center gap-3 p-4">
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
      {events.map((e, i) => {
        const chips = [
          e.price ? (
            <Chip key="p" tint={/free/i.test(e.price) ? "free" : "cost"}>
              {e.price}
            </Chip>
          ) : null,
          e.age ? (
            <Chip key="a" tint="age">
              {e.age}
            </Chip>
          ) : null,
          e.setting ? (
            <Chip key="s" tint={e.setting}>
              {e.setting === "indoor" ? "Indoor" : "Outdoor"}
            </Chip>
          ) : null,
        ].filter(Boolean);
        const place = (
          <p className="flex min-w-0 items-center gap-1 text-sm leading-tight text-ink-soft">
            <Icon name="pin" size={15} className="shrink-0" />
            <span className="truncate">{e.place}</span>
          </p>
        );
        return (
          <li key={e.slug} className={`${CARD} relative snap-start`}>
            {e.annual || e.regular ? (
              <span
                className={`absolute -top-2.5 right-3 z-10 rotate-2 rounded-[var(--radius-wobbly-2)] border-2 border-ink px-2 font-hand text-[0.95rem] leading-tight shadow-[1.5px_1.5px_0_var(--color-ink)] ${e.annual ? "bg-crayon-pink text-paper" : "bg-crayon-teal text-paper"}`}
              >
                {e.annual ? "Once a year" : "Regular"}
              </span>
            ) : null}
            <Link
              href={e.href}
              data-scoop="event"
              aria-label={[
                e.title,
                e.annual ? "once a year" : null,
                e.regular ? "a regular" : null,
                e.when.replace(" · ", " at "),
                e.line.kind === "what" ? e.line.text : null,
                e.place,
                e.age,
                e.price,
              ]
                .filter(Boolean)
                .join(", ")}
              className={`${i % 2 ? "doodle-box-alt" : "doodle-box"} flex h-full flex-col overflow-hidden transition-transform active:scale-[0.98]`}
            >
              <div className="flex shrink-0 flex-col gap-1 px-3.5 pt-3 pb-2.5">
                <p
                  className={`font-hand text-[1.05rem] leading-none ${/^(Next: )?(Today|Tomorrow)/.test(e.when) ? "text-ink" : "text-ink-soft"}`}
                >
                  {e.when}
                </p>
                <p
                  className={`font-hand leading-[1.1] ${e.title.length > 40 ? "line-clamp-2 text-[1.12rem]" : "line-clamp-2 text-[1.3rem]"}`}
                >
                  {e.title}
                </p>
                {e.line.kind === "what" ? (
                  <p className="line-clamp-3 text-[0.9rem] leading-snug">
                    {e.line.text}
                  </p>
                ) : (
                  <p className="flex items-center gap-1 font-hand text-lg leading-snug">
                    <Icon name="pin" size={18} className="shrink-0" />
                    <span className="truncate">{e.place}</span>
                  </p>
                )}
              </div>
              {/* The footer takes the rest, so any spare room is a tinted band, not a gap. */}
              <div
                className={`flex flex-1 flex-col gap-1 ${e.line.kind === "where" ? "justify-center" : ""} border-t-2 border-dashed border-ink/20 bg-[color-mix(in_srgb,var(--color-crayon-yellow)_12%,#fffdf7)] px-3.5 pt-2 pb-2`}
              >
                {e.line.kind === "what" ? place : null}
                {chips.length ? (
                  <div className="flex h-7 flex-nowrap gap-1.5 overflow-hidden">
                    {chips}
                  </div>
                ) : null}
                {e.line.kind === "where" ? (
                  // No line to show: a doodle and a nudge, not an empty band.
                  <p className="flex items-center justify-center gap-2 font-hand text-xl leading-tight">
                    <Icon name="sparkles" size={40} className="shrink-0" />
                    Tap for what&apos;s on
                  </p>
                ) : null}
              </div>
            </Link>
          </li>
        );
      })}
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
