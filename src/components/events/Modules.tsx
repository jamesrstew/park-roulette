import Link from "next/link";
import { milesBetween } from "@/lib/geo";
import { upcomingDates, whenLine } from "@/lib/events/model";
import { allEvents, listed } from "@/lib/events/store";
import { addDays, pacific } from "@/lib/news/time";
import { townSlug } from "@/lib/towns";

/**
 * Kids' events on other pages: "Coming up in {Town}" on town pages (up to
 * 3) and "Happening nearby" on park pages (within 2 miles, next 14 days).
 * Each drops when it's empty. Callers are already dynamic.
 */

function Rows({
  items,
}: {
  items: { slug: string; title: string; when: string; place: string }[];
}) {
  return (
    <ul className="flex flex-col divide-y divide-dashed divide-ink/20">
      {items.map((x) => (
        <li key={x.slug} className="py-2">
          <Link
            href={`/events/${x.slug}`}
            className="font-hand text-xl underline"
          >
            {x.title}
          </Link>
          <p className="text-[0.95rem] text-ink-soft">
            {x.when} · {x.place}
          </p>
        </li>
      ))}
    </ul>
  );
}

export async function ComingUpInTown({
  town,
}: {
  town: { name: string; slug: string };
}) {
  const now = new Date();
  const items = (await allEvents())
    .filter((r) => listed(r, now) && townSlug(r.data.venue.town) === town.slug)
    .map((r) => ({ r, n: upcomingDates(r.data, now)[0] }))
    .sort((a, b) => a.n.day.localeCompare(b.n.day))
    .slice(0, 3);
  if (!items.length) return null;
  return (
    <section aria-labelledby="coming-h" className="flex flex-col gap-2">
      <h2 id="coming-h" className="font-hand text-3xl leading-tight">
        Coming up in {town.name}
      </h2>
      <Rows
        items={items.map(({ r, n }) => ({
          slug: r.slug,
          title: r.data.title,
          when: whenLine(n),
          place: r.data.venue.name,
        }))}
      />
      <Link href="/events" className="underline">
        All kids&apos; events
      </Link>
    </section>
  );
}

export async function HappeningNearby({
  park,
}: {
  park: { slug: string; lat: number; lng: number };
}) {
  const now = new Date();
  const until = addDays(pacific(now).date, 14);
  const items = (await allEvents())
    .filter((r) => listed(r, now) && r.data.point)
    .filter(
      (r) =>
        r.data.venue.park === park.slug ||
        milesBetween(r.data.point!, park) <= 2,
    )
    .map((r) => ({ r, n: upcomingDates(r.data, now)[0] }))
    .filter((x) => x.n.day <= until)
    .sort((a, b) => a.n.day.localeCompare(b.n.day))
    .slice(0, 3);
  if (!items.length) return null;
  return (
    <section aria-labelledby="nearby-h" className="mt-6 flex flex-col gap-2">
      <h2 id="nearby-h" className="font-hand text-3xl leading-tight">
        Happening nearby
      </h2>
      <Rows
        items={items.map(({ r, n }) => ({
          slug: r.slug,
          title: r.data.title,
          when: whenLine(n),
          place: r.data.venue.name,
        }))}
      />
    </section>
  );
}
