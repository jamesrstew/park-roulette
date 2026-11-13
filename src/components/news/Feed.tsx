import Link from "next/link";
import { Icon, attrIcon } from "@/components/icons";
import { PageTitle } from "@/components/PageTitle";
import { JoinNudge } from "@/components/park/JoinNudge";
import { fixLine } from "@/lib/fix-words";
import { Stars } from "@/components/Stars";
import { crayon } from "@/lib/crayons";
import type { FeedItem, FeedPark, FeedReview } from "@/lib/data-feed";
import { ATTRIBUTES } from "@/lib/features";

/** "Today", "Yesterday", "Tuesday", "Nov 3": never the exact time. */
export function dayLabel(iso: string, now: number): string {
  const tz = { timeZone: "America/Los_Angeles" } as const;
  const day = (t: number) => new Date(t).toLocaleDateString("en-CA", tz);
  const t = new Date(iso).getTime();
  if (day(t) === day(now)) return "Today";
  if (day(t) === day(now - 86400000)) return "Yesterday";
  if (now - t < 6 * 86400000)
    return new Date(t).toLocaleDateString("en-US", { ...tz, weekday: "long" });
  return new Date(t).toLocaleDateString("en-US", {
    ...tz,
    month: "short",
    day: "numeric",
  });
}

/** The town's news: new reviews and park fixes, newest first. */
export function Feed({
  items,
  signedIn,
  now,
}: {
  items: FeedItem[];
  signedIn: boolean;
  now: number;
}) {
  return (
    <div className="flex flex-col gap-5">
      <PageTitle
        lead="What's"
        accent="new"
        color="teal"
        underline="pink"
        underlineWidth="w-32"
        subtitle={
          <p>
            Fresh reviews and park news from families around Central Oregon.
          </p>
        }
      />
      {!signedIn && (
        <JoinNudge
          icon="eyes"
          line="Families see photos and more reviews here. Hop in!"
        />
      )}
      {items.length === 0 ? (
        <div className="doodle-box flex flex-col items-center gap-2 px-4 py-8 text-center">
          <Icon name="sparkles" size={48} />
          <p className="font-hand text-2xl">
            So quiet you can hear the crickets.
          </p>
          <p className="text-ink-soft">
            Visit a park and leave the first review!
          </p>
          <Link
            href="/"
            className="crayon-btn wax mt-2 min-h-12 bg-crayon-yellow px-5 text-xl"
          >
            Spin for a park
          </Link>
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {items.map((item) => (
            <li key={`${item.type}-${item.id}`}>
              {item.type === "review" ? (
                <ReviewItem r={item} now={now} />
              ) : (
                <ParkItem p={item} now={now} />
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-center text-xs leading-snug text-ink-soft">
        Reviews from other families show up an hour after they&apos;re written,
        so nobody can tell where you are right now.
      </p>
    </div>
  );
}

function ReviewItem({ r, now }: { r: FeedReview; now: number }) {
  const color = crayon(r.explorer.color);
  const tags = r.tags.filter((t) => ATTRIBUTES[t]).slice(0, 4);
  return (
    <Link
      href={`/parks/${r.park.slug}#reviews`}
      className="doodle-box flex flex-col gap-2.5 p-4 transition-transform active:scale-[0.98]"
    >
      <div className="flex items-center gap-3">
        <span
          className="wax grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-blob)] border-[2.5px] border-ink text-2xl"
          style={{ backgroundColor: color }}
          aria-hidden
        >
          {r.explorer.avatar}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-hand text-xl leading-tight">
            <span style={r.explorer.color === "yellow" ? undefined : { color }}>
              {r.explorer.name}
            </span>{" "}
            reviewed {r.park.name}
          </p>
          <p className="truncate text-xs text-ink-soft">
            {r.explorer.crewName} · {r.park.city} · {dayLabel(r.at, now)}
          </p>
        </div>
      </div>
      <Stars tenths={r.ratingTenths} size={18} />
      {r.body && (
        <p className="line-clamp-4 leading-relaxed whitespace-pre-line">
          {r.body}
        </p>
      )}
      {tags.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Tags">
          {tags.map((t) => (
            <li
              key={t}
              className="inline-flex items-center gap-1 rounded-full border-[1.5px] border-ink/40 px-2 py-0.5 text-[0.8rem]"
            >
              <Icon name={attrIcon(t)} size={18} />
              {ATTRIBUTES[t].label}
            </li>
          ))}
        </ul>
      )}
      {r.photos.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {r.photos.map((src) => (
            // eslint-disable-next-line @next/next/no-img-element -- our own photo door redirects to private storage
            <img
              key={src}
              src={src}
              alt=""
              loading="lazy"
              className="aspect-square w-full rounded-lg border-2 border-ink object-cover"
            />
          ))}
        </div>
      )}
    </Link>
  );
}

function ParkItem({ p, now }: { p: FeedPark; now: number }) {
  const isNew = p.topic === "exists";
  return (
    <Link
      href={`/parks/${p.park.slug}`}
      className="doodle-box-alt flex items-center gap-3 p-3 transition-transform active:scale-[0.98]"
    >
      <Icon name={isNew ? "pin" : "wrench"} size={34} />
      <div className="min-w-0 flex-1">
        <p className="font-hand text-xl leading-tight">
          {isNew ? `New on the map: ${p.park.name}` : p.park.name}
        </p>
        <p className="text-sm leading-snug text-ink-soft">
          {isNew
            ? `${p.park.city} · confirmed by families`
            : `${fixLine(p.topic, p.value)} · ${p.families > 1 ? `${p.families} families agreed` : "fixed"}`}{" "}
          · {dayLabel(p.at, now)}
        </p>
      </div>
    </Link>
  );
}
