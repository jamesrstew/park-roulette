import Link from "next/link";
import { Icon } from "@/components/icons";
import { PageTitle } from "@/components/PageTitle";
import { Faq, Section, SpinCta } from "@/components/seo/Guide";
import { JsonLd } from "@/components/seo/JsonLd";
import { FooterLinks, PairCard } from "@/components/seo/PairingGuide";
import { pairingGuidePath, type PairingGuideView } from "@/lib/pairing-guides";
import {
  pairAnchorId,
  pairingPageJsonLd,
  pairingPagePath,
  PAIRINGS_HUB,
  type PairingPageView,
} from "@/lib/pairing-pages";
import { postPath } from "@/lib/social/links";
import { SITE_URL } from "@/lib/site";

const COLOR = {
  coffee: { color: "orange", underline: "blue" },
  food_trucks: { color: "teal", underline: "yellow" },
  breweries: { color: "green", underline: "orange" },
  treats: { color: "pink", underline: "purple" },
} as const;

/**
 * A pairing page (/guides/pairings/<slug>): one park pairings post kept as
 * a guide. Its angle and intro, the bigger town guides for more choices,
 * each pair with its links, the questions parents ask, then the newest
 * other pairing pages and the hub.
 */
export function PairingPage({
  v,
  guides,
  others,
  postShown,
}: {
  v: PairingPageView;
  /** The theme-and-town guides it leads to, that exist now. */
  guides: readonly PairingGuideView[];
  /** A few other pairing pages, newest first. */
  others: readonly PairingPageView[];
  /** Its post's page is public (a post a photo check took down isn't). */
  postShown: boolean;
}) {
  const c = COLOR[v.theme];
  return (
    <article className="flex flex-col gap-7">
      <JsonLd data={pairingPageJsonLd(v, SITE_URL)} />
      <nav aria-label="Breadcrumb" className="text-sm text-ink-soft">
        <Link href="/" className="underline">
          Park Roulette
        </Link>{" "}
        ›{" "}
        <Link href="/guides" className="underline">
          Guides
        </Link>{" "}
        ›{" "}
        <Link href={PAIRINGS_HUB} className="underline">
          Park pairings
        </Link>
      </nav>
      <PageTitle
        accent={v.h1.accent}
        trail={v.h1.trail}
        color={c.color}
        underline={c.underline}
        underlineWidth="w-40"
        size="text-4xl"
      />
      <p className="-mt-4 text-sm text-ink">
        Updated <time dateTime={v.changed.slice(0, 10)}>{v.changedLabel}</time>{" "}
        · first in{" "}
        {postShown ? (
          <Link href={postPath(v.postId)} className="underline">
            our {v.bornShort} post
          </Link>
        ) : (
          <>our {v.bornShort} post</>
        )}
      </p>
      <div className="doodle-box flex flex-col gap-2 bg-[color-mix(in_srgb,var(--color-crayon-yellow)_14%,#fffdf7)] p-4 leading-relaxed">
        {v.angle ? (
          <p className="font-hand text-2xl leading-tight">{v.angle}</p>
        ) : null}
        <p>{v.intro}</p>
        <p className="text-[0.95rem] text-ink-soft">{v.anchorsLine}</p>
      </div>
      {guides.length ? (
        <section className="flex flex-col gap-1" aria-labelledby="more">
          <h2 id="more" className="font-hand text-2xl leading-tight">
            Want more choices?
          </h2>
          <ul className="flex flex-col">
            {guides.map((g) => (
              <li key={g.def.slug}>
                <Link
                  href={pairingGuidePath(g.def.slug)}
                  className="flex min-h-11 items-center gap-2 leading-tight underline"
                >
                  <Icon
                    name={g.def.rainy ? "home" : "playground"}
                    size={24}
                    className="shrink-0"
                  />
                  {g.def.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <Section title="The pairs" id="pairs">
        <ol className="flex flex-col gap-3">
          {v.pairs.map((p, i) => (
            <PairCard key={p.placeId} p={p} n={i + 1} id={pairAnchorId(i)} />
          ))}
        </ol>
      </Section>
      {v.faq.length ? (
        <Section title="Questions parents ask" id="faq">
          <Faq items={v.faq} />
        </Section>
      ) : null}
      <Section title="Good to know" id="tips">
        <ul className="flex flex-col gap-2">
          {v.tips.map((t) => (
            <li key={t} className="flex items-start gap-2 leading-snug">
              <Icon name="star" size={22} className="mt-0.5 shrink-0" />
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </Section>
      <SpinCta />
      <FooterLinks
        label="More park pairings"
        links={[
          ...others.map((o) => ({
            href: pairingPagePath(o.slug),
            name: o.name,
          })),
          { href: PAIRINGS_HUB, name: "All park pairings" },
          { href: "/guides", name: "All guides" },
        ]}
      />
      <p className="text-center text-sm leading-snug text-ink">
        Places come from their own sites and Google Maps; park details from park
        pages and local families.
      </p>
    </article>
  );
}
