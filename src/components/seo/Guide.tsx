import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/icons";
import { Stars } from "@/components/Stars";
import { parkFacts, listWords } from "@/lib/park-facts";
import { formatStars } from "@/lib/rating";
import type { PublicPark } from "@/lib/seo-data";

/** The few things parents ask about most, in table order. */
const KEY_FEATURES: [string, string][] = [
  ["splash_pad", "splash pad"],
  ["toddler_area", "toddler area"],
  ["baby_swings", "baby swings"],
  ["fenced", "fenced"],
  ["swings", "swings"],
  ["shade", "shade"],
  ["restrooms", "restrooms"],
  ["accessible", "accessible"],
];

export function goodFor(p: PublicPark, max = 5): string[] {
  const f = parkFacts(p);
  return KEY_FEATURES.filter(([k]) => f.has(k))
    .map(([, w]) => w)
    .slice(0, max);
}

export function Section({
  title,
  id,
  children,
}: {
  title: string;
  id?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="flex scroll-mt-6 flex-col gap-3">
      <h2 className="font-hand text-3xl leading-tight">{title}</h2>
      {children}
    </section>
  );
}

/** "Updated November 13, 2026" */
export function Updated({ iso, label }: { iso: string; label: string }) {
  return (
    <p className="text-center text-sm text-ink-soft">
      Updated <time dateTime={iso}>{label}</time>
    </p>
  );
}

export function TopRated({ parks }: { parks: PublicPark[] }) {
  return (
    <ol className="flex flex-col gap-2">
      {parks.map((p, i) => (
        <li key={p.id}>
          <Link
            href={`/parks/${p.slug}`}
            className="doodle-box flex items-center gap-3 px-3 py-2.5"
          >
            <span className="font-hand text-2xl text-ink-soft">{i + 1}.</span>
            <span className="min-w-0 flex-1">
              <span className="block font-hand text-xl leading-tight">
                {p.name}
              </span>
              <span className="text-xs text-ink-soft">
                {p.city} · {p.reviewCount}{" "}
                {p.reviewCount === 1 ? "review" : "reviews"}
              </span>
            </span>
            <Stars tenths={p.avgTenths!} size={14} />
          </Link>
        </li>
      ))}
    </ol>
  );
}

/** Every park in a plain table: name, stars, what it's good for. */
export function CompareTable({
  parks,
  caption = "Parks compared",
  showTown = false,
}: {
  parks: PublicPark[];
  caption?: string;
  showTown?: boolean;
}) {
  return (
    <div
      className="doodle-box overflow-x-auto p-2"
      role="region"
      aria-label={caption}
      tabIndex={0}
    >
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b-2 border-ink/20 font-hand text-lg">
            <th scope="col" className="p-2 font-normal">
              Park
            </th>
            <th scope="col" className="p-2 font-normal">
              Stars
            </th>
            <th scope="col" className="p-2 font-normal">
              Good for
            </th>
          </tr>
        </thead>
        <tbody>
          {parks.map((p) => (
            <tr key={p.id} className="border-b border-ink/10 align-top">
              <td className="p-2">
                <Link href={`/parks/${p.slug}`} className="underline">
                  {p.name}
                </Link>
                {showTown && (
                  <span className="block text-xs text-ink-soft">{p.city}</span>
                )}
                {p.play === "none" && (
                  <span className="block text-xs text-ink-soft">
                    no playground
                  </span>
                )}
              </td>
              <td className="p-2 whitespace-nowrap">
                {p.avgTenths != null && p.reviewCount > 0 ? (
                  <>
                    {formatStars(p.avgTenths)}{" "}
                    <span className="text-xs text-ink-soft">
                      ({p.reviewCount}
                      <span className="sr-only">
                        {p.reviewCount === 1 ? " rating" : " ratings"}
                      </span>
                      )
                    </span>
                  </>
                ) : (
                  <>
                    <span aria-hidden>–</span>
                    <span className="sr-only">No stars yet</span>
                  </>
                )}
              </td>
              <td className="p-2">
                {goodFor(p).join(", ") || (
                  <>
                    <span aria-hidden>–</span>
                    <span className="sr-only">Nothing reported yet</span>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export type Qa = { q: string; a: string };

export function Faq({ items }: { items: Qa[] }) {
  return (
    <dl className="flex flex-col gap-3">
      {items.map((x) => (
        <div key={x.q} className="doodle-box-alt p-3">
          <dt className="font-hand text-xl leading-tight">{x.q}</dt>
          <dd className="mt-1 leading-snug">{x.a}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Names as a sentence, each a link: "Drake Park, Juniper Park and …". */
export function nameList(parks: PublicPark[], max = 5): string {
  const names = parks.slice(0, max).map((p) => p.name);
  const more = parks.length - names.length;
  return more > 0 ? `${names.join(", ")} and ${more} more` : listWords(names);
}

export function SpinCta() {
  return (
    <Link
      href="/"
      className="crayon-btn wax mx-auto flex min-h-12 w-full max-w-xs items-center justify-center gap-2 bg-crayon-yellow text-xl"
    >
      Can&apos;t pick? Spin the wheel <Icon name="spin" size={28} />
    </Link>
  );
}
