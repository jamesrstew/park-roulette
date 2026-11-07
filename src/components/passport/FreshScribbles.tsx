import Link from "next/link";
import { Stars } from "@/components/Stars";
import { crayon } from "@/lib/crayons";
import { SectionTitle, tilt } from "./bits";

export type ScribbleView = {
  id: number;
  ratingTenths: number;
  body: string;
  updatedAt: Date;
  park: { slug: string; name: string; city: string };
  explorer: { name: string; color: string; avatar: string };
};

function ago(d: Date, now: number): string {
  const mins = Math.max(0, Math.round((now - d.getTime()) / 60000));
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.round(hrs / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/Los_Angeles",
  });
}

export function FreshScribbles({
  reviews,
  now,
}: {
  reviews: ScribbleView[];
  now: number;
}) {
  return (
    <section aria-labelledby="fresh-h">
      <SectionTitle icon="edit" color="#1fa4a8">
        <span id="fresh-h">Fresh scribbles</span>
      </SectionTitle>
      {reviews.length === 0 ? (
        <div className="doodle-box flex flex-col items-center gap-2 px-4 py-6 text-center">
          <span aria-hidden className="text-4xl">
            🦗
          </span>
          <p className="font-hand text-xl text-ink-soft">
            So quiet you can hear the crickets. Visit a park and leave the first
            review!
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {reviews.map((r) => (
            <li key={r.id}>
              <Link
                href={`/parks/${r.park.slug}`}
                className="doodle-box flex gap-3 px-3 py-3 transition-transform active:scale-[0.98]"
              >
                <span
                  aria-hidden
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-[2.5px] border-ink text-xl"
                  style={{
                    backgroundColor: crayon(r.explorer.color),
                    transform: `rotate(${tilt(r.id, 8)}deg)`,
                  }}
                >
                  {r.explorer.avatar}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="leading-tight">
                    <b className="font-hand text-lg">{r.explorer.name}</b>
                    <span className="text-ink-soft"> on </span>
                    <b className="font-hand text-lg">{r.park.name}</b>
                  </span>
                  <span className="flex items-center justify-between gap-2">
                    <Stars tenths={r.ratingTenths} size={15} />
                    <span className="text-xs text-ink-soft">
                      {ago(r.updatedAt, now)}
                    </span>
                  </span>
                  {r.body && (
                    <span className="line-clamp-2 text-[0.95rem] leading-snug text-ink-soft">
                      “{r.body}”
                    </span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
