import type { ReactNode } from "react";
import { crayon } from "@/lib/crayons";
import type { ReviewView } from "@/lib/data";
import { ATTRIBUTES } from "@/lib/features";
import { verdict } from "@/lib/rating";
import { Stars } from "../Stars";
import { formatStamp } from "./format";
import { MediaGrid } from "./Lightbox";

/** One critic's take. Works on the server and inside client components. */
export function ReviewCard({
  review,
  mine = false,
  alt = false,
  actions,
}: {
  review: ReviewView;
  mine?: boolean;
  alt?: boolean;
  actions?: ReactNode;
}) {
  const color = crayon(review.explorer.color);
  const isYellow = review.explorer.color === "yellow";
  const tags = review.tags.filter((t) => ATTRIBUTES[t]);
  const heads = tags.filter((t) => ATTRIBUTES[t].kind === "heads_up");
  const good = tags.filter((t) => ATTRIBUTES[t].kind === "good");
  const edited =
    review.updatedAt.slice(0, 10) !== review.createdAt.slice(0, 10);

  return (
    <article
      className={`${alt ? "doodle-box-alt" : "doodle-box"} relative flex flex-col gap-2.5 p-4 ${mine ? "shadow-[4px_5px_0_var(--c)]" : ""}`}
      style={{ ["--c" as string]: color }}
    >
      {mine && (
        <span
          className="absolute -top-3 left-5 rotate-[-4deg] rounded-sm border-2 border-ink bg-crayon-yellow px-2 font-hand text-base leading-6"
          aria-label="Your review"
        >
          ✏️ You
        </span>
      )}
      <header className="flex items-center gap-3">
        <span
          className="wax grid h-12 w-12 shrink-0 place-items-center rounded-[var(--radius-blob)] border-[2.5px] border-ink text-2xl"
          style={{ backgroundColor: color }}
          aria-hidden
        >
          {review.explorer.avatar}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-hand text-[1.4rem] leading-tight">
            <span
              className={isYellow ? "highlight" : ""}
              style={isYellow ? { ["--hl" as string]: color } : { color }}
            >
              {review.explorer.name}
            </span>
          </p>
          <p className="truncate text-xs text-ink-soft">
            {review.explorer.crewName} · {formatStamp(review.updatedAt)}
            {edited ? " (edited)" : ""}
          </p>
        </div>
        <div className="flex flex-col items-end">
          <Stars tenths={review.ratingTenths} size={15} />
          <span className="font-hand text-sm leading-none text-ink-soft">
            {verdict(review.ratingTenths)}
          </span>
        </div>
      </header>

      {review.body && (
        <p className="leading-relaxed whitespace-pre-line">{review.body}</p>
      )}

      {tags.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Tags">
          {[...heads, ...good].map((t) => {
            const a = ATTRIBUTES[t];
            const h = a.kind === "heads_up";
            return (
              <li
                key={t}
                className={`inline-flex items-center gap-1 rounded-full border-[1.5px] px-2 py-0.5 text-[0.8rem] ${h ? "border-crayon-red bg-[color-mix(in_srgb,var(--color-crayon-orange)_18%,#fffdf7)]" : "border-ink/40"}`}
              >
                <span aria-hidden>{a.emoji}</span>
                {a.label}
              </li>
            );
          })}
        </ul>
      )}

      <MediaGrid items={review.media} />

      {actions}
    </article>
  );
}
