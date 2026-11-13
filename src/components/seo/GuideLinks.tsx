import Link from "next/link";
import {
  FEATURE_PAGE_MIN,
  FEATURE_PAGES,
  hasOwnPage,
  type PublicPark,
  townsOf,
} from "@/lib/seo-data";

/** "Find a playground": links to every town and feature guide. */
export function GuideLinks({ parks }: { parks: PublicPark[] }) {
  const towns = townsOf(parks).filter(hasOwnPage);
  const features = FEATURE_PAGES.filter(
    (f) => parks.filter(f.matches).length >= FEATURE_PAGE_MIN,
  );
  return (
    <nav
      aria-label="Find a playground"
      className="mt-6 flex flex-col gap-2 text-center text-sm leading-relaxed text-ink-soft"
    >
      <p>
        <span className="font-hand text-lg text-ink">Playgrounds in </span>
        {towns.map((t, i) => (
          <span key={t.slug}>
            {i > 0 && " · "}
            <Link href={`/towns/${t.slug}`} className="underline">
              {t.name}
            </Link>
          </span>
        ))}
        {" · "}
        <Link href="/towns" className="underline">
          all of Central Oregon
        </Link>
      </p>
      <p>
        {features.map((f, i) => (
          <span key={f.slug}>
            {i > 0 && " · "}
            <Link href={`/playgrounds/${f.slug}`} className="underline">
              {f.title}
            </Link>
          </span>
        ))}
      </p>
    </nav>
  );
}
