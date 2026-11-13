import Link from "next/link";
import { Icon } from "@/components/icons";

/**
 * One plain paragraph about the park, built from its data. Handy for
 * grown-ups skimming, and the paragraph search engines and AI assistants
 * quote.
 */
export function AboutPark({
  summary,
  city,
  townLink,
}: {
  summary: string;
  city: string;
  townLink: string;
}) {
  return (
    <section
      aria-labelledby="about-h"
      className="doodle-box-alt flex flex-col gap-2 px-4 py-3"
    >
      <h2 id="about-h" className="flex items-center gap-2 font-hand text-2xl">
        <Icon name="book" size={28} /> About this park
      </h2>
      <p className="leading-relaxed">{summary}</p>
      <p className="text-sm">
        <Link href={townLink} className="underline underline-offset-2">
          More playgrounds in {city}
        </Link>
      </p>
    </section>
  );
}
