import Link from "next/link";
import { Icon, attrIcon } from "@/components/icons";
import { Stars } from "@/components/Stars";
import { crayon } from "@/lib/crayons";
import type { FreshReview } from "@/lib/data-feed";
import { ATTRIBUTES } from "@/lib/features";
import { dayLabel, excerpt } from "@/lib/scoop";

/**
 * The newest reviews this viewer may see, newest first. Each card links to
 * the park's reviews: the park (heading), stars, a short excerpt (a kid's
 * review has no words, so its tags show), the byline and the day.
 */
export function ScoopReviews({
  reviews,
  now,
}: {
  reviews: FreshReview[];
  now: number;
}) {
  if (!reviews.length)
    return (
      <div className="doodle-box flex flex-col items-center gap-2 px-4 py-6 text-center">
        <Icon name="sparkles" size={44} />
        <p className="font-hand text-2xl">
          So quiet you can hear the crickets.
        </p>
        <p className="text-ink-soft">
          Visit a park and leave the first review!
        </p>
        <Link
          href="/"
          className="crayon-btn wax mt-1 min-h-12 bg-crayon-yellow px-5 text-xl"
        >
          Spin for a park
        </Link>
      </div>
    );
  return (
    <ul className="flex flex-col gap-3">
      {reviews.map((r) => (
        <li key={r.id}>
          <ReviewCard r={r} now={now} />
        </li>
      ))}
    </ul>
  );
}

function ReviewCard({ r, now }: { r: FreshReview; now: number }) {
  const color = crayon(r.explorer.color);
  const words = r.body.trim();
  const tags = words ? [] : r.tags.filter((t) => ATTRIBUTES[t]).slice(0, 2);
  return (
    <Link
      href={`/parks/${r.park.slug}#reviews`}
      data-scoop="review"
      className="doodle-box flex gap-3 p-3.5 transition-transform active:scale-[0.98]"
    >
      <span
        className="wax grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-blob)] border-[2.5px] border-ink text-xl"
        style={{ backgroundColor: color }}
        aria-hidden
      >
        {r.explorer.avatar}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h3 className="truncate font-hand text-[1.4rem] leading-tight">
          {r.park.name}
        </h3>
        <Stars tenths={r.ratingTenths} size={16} />
        {words ? (
          <p className="line-clamp-2 leading-snug">{excerpt(words)}</p>
        ) : tags.length ? (
          <ul className="flex flex-wrap gap-1.5" aria-label="Tags">
            {tags.map((t) => (
              <li
                key={t}
                className="inline-flex items-center gap-1 rounded-full border-[1.5px] border-ink/40 px-2 py-0.5 text-[0.8rem]"
              >
                <Icon name={attrIcon(t)} size={16} />
                {ATTRIBUTES[t].label}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="text-[0.85rem] leading-snug text-ink-soft">
          <span className="block truncate">
            <span className="font-semibold text-ink">{r.explorer.name}</span>
            {r.ours ? "" : ` from ${r.explorer.crewName}`}
          </span>
          <span className="block truncate">
            {r.park.city} · {dayLabel(r.at, now)}
          </span>
        </p>
      </div>
    </Link>
  );
}
