import Link from "next/link";
import { Icon } from "@/components/icons";
import { PageTitle } from "@/components/PageTitle";
import { Faq, Section, SpinCta } from "@/components/seo/Guide";
import { Chip } from "@/components/events/EventBits";
import { JsonLd } from "@/components/seo/JsonLd";
import { GUIDES, guidePath } from "@/lib/guides";
import {
  type GuidePair,
  mapsHref,
  PAIRING_GUIDES,
  pairingGuideJsonLd,
  pairingGuidePath,
  type PairingGuideView,
} from "@/lib/pairing-guides";
import {
  pairAnchorId,
  pairingPagePath,
  PAIRINGS_HUB,
  type PairingPageView,
} from "@/lib/pairing-pages";
import { SITE_URL } from "@/lib/site";

const COLOR = {
  coffee: { color: "orange", underline: "blue" },
  food_trucks: { color: "teal", underline: "yellow" },
  breweries: { color: "green", underline: "orange" },
  treats: { color: "pink", underline: "purple" },
} as const;

/**
 * A park pairings guide (/guides/<slug>): the intro, a few tips, then each
 * pair (the place, the anchor, our distance, our line about the anchor)
 * with its links. Laid out like the seasonal guides, mobile first.
 */
export function PairingGuide({
  v,
  existing,
  outings = [],
}: {
  v: PairingGuideView;
  /** The other pairing guides that exist now (links at the foot). */
  existing: readonly string[];
  /** Pairing pages from our posts in its theme and town, newest first. */
  outings?: readonly PairingPageView[];
}) {
  const c = v.def.rainy
    ? ({ color: "purple", underline: "teal" } as const)
    : COLOR[v.def.theme];
  const others = PAIRING_GUIDES.filter(
    (g) => g.slug !== v.def.slug && existing.includes(g.slug),
  );
  return (
    <article className="flex flex-col gap-7">
      <JsonLd data={pairingGuideJsonLd(v, SITE_URL)} />
      <nav aria-label="Breadcrumb" className="text-sm text-ink-soft">
        <Link href="/" className="underline">
          Park Roulette
        </Link>{" "}
        ›{" "}
        <Link href="/guides" className="underline">
          Guides
        </Link>
      </nav>
      <PageTitle
        lead={v.def.h1.lead}
        accent={v.def.h1.accent}
        trail={v.def.h1.trail}
        color={c.color}
        underline={c.underline}
        underlineWidth="w-48"
        size="text-4xl"
      />
      <p className="-mt-4 text-sm text-ink">
        Updated <time dateTime={v.updated.slice(0, 10)}>{v.updatedLabel}</time>
      </p>
      <p className="doodle-box bg-[color-mix(in_srgb,var(--color-crayon-yellow)_14%,#fffdf7)] p-4 leading-relaxed">
        {v.intro}
      </p>
      <Section title="The pairs" id="pairs">
        <ol className="flex flex-col gap-3">
          {v.pairs.map((p, i) => (
            <PairCard
              key={p.placeId}
              p={p}
              n={i + 1}
              id={pairAnchorId(i)}
              town={v.def.town}
            />
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
      {outings.length ? (
        <Section title="From our posts" id="outings">
          <ul className="flex flex-col gap-1">
            {outings.map((o) => (
              <li key={o.slug}>
                <Link
                  href={pairingPagePath(o.slug)}
                  className="flex min-h-11 items-center gap-2 leading-tight underline"
                >
                  <Icon name="star" size={22} className="shrink-0" />
                  {o.name}
                </Link>
              </li>
            ))}
          </ul>
          <Link href={PAIRINGS_HUB} className="underline">
            Every park pairing, newest first
          </Link>
        </Section>
      ) : null}
      <SpinCta />
      <FooterLinks
        label="More guides"
        links={[
          ...others.map((g) => ({
            href: pairingGuidePath(g.slug),
            name: g.name,
          })),
          ...GUIDES.filter((g) =>
            v.def.rainy
              ? g.slug === "indoor-play-bend"
              : g.slug === "sledding-hills-bend",
          ).map((g) => ({ href: guidePath(g.slug), name: g.name })),
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

const CHIP =
  "inline-flex min-h-11 items-center gap-1.5 rounded-[12px_14px_10px_16px] border-2 border-ink bg-white/70 px-3 text-[0.95rem]";

/**
 * Links at a guide's foot, each a full 44 px tap target, wrapping in rows.
 */
export function FooterLinks({
  label,
  links,
}: {
  label: string;
  links: readonly { href: string; name: string }[];
}) {
  return (
    <nav aria-label={label} className="flex flex-col items-center gap-1">
      <h2 className="font-hand text-xl text-ink-soft">{label}</h2>
      <ul className="flex flex-wrap justify-center gap-x-4 text-sm">
        {links.map((l) => (
          <li key={l.href}>
            <Link
              href={l.href}
              className="inline-flex min-h-11 items-center underline"
            >
              {l.name}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function PairCard({
  p,
  n,
  id,
  town,
}: {
  p: GuidePair;
  n: number;
  /** The card's anchor (its ItemList url points here). */
  id?: string;
  /** The guide's town, to help Maps find the place. */
  town?: string;
}) {
  const external = !p.anchorHref.startsWith("/");
  const anchorIcon = p.anchorKind === "park" ? "playground" : "home";
  return (
    <li
      id={id}
      className="doodle-box flex scroll-mt-6 flex-col gap-2 px-4 py-3"
    >
      <h3 className="flex flex-col gap-0.5 font-hand text-2xl leading-tight">
        <span className="flex items-start gap-2">
          <span className="text-ink-soft">{n}.</span>
          <Icon name="cup" size={26} className="mt-0.5 shrink-0" />
          <span>{p.place}</span>
        </span>
        <span className="flex items-start gap-2 pl-6">
          <span className="text-crayon-red">+</span>
          <Icon name={anchorIcon} size={26} className="mt-0.5 shrink-0" />
          <span>{p.anchorName}</span>
        </span>
      </h3>
      <p className="flex items-center gap-1.5 text-[0.95rem] text-ink-soft">
        <Icon name={p.walk ? "trail" : "car"} size={20} />
        {p.apart}
      </p>
      <p className="leading-snug">
        <b className="font-semibold">{p.anchorLabel}:</b> {p.anchorLine}
      </p>
      {p.anchorHas?.length ? (
        <div className="flex flex-wrap gap-1.5">
          {p.anchorHas.map((h) => (
            <Chip key={h}>{h}</Chip>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {external ? (
          <a href={p.anchorHref} className={CHIP}>
            <Icon name={anchorIcon} size={20} />{" "}
            {/^At the /.test(p.anchorLabel)
              ? p.anchorLabel.replace(/^At the /, "See the ")
              : "Their page"}
          </a>
        ) : (
          <Link href={p.anchorHref} className={CHIP}>
            <Icon name={anchorIcon} size={20} /> See the park
          </Link>
        )}
        <a
          href={p.site ?? mapsHref(p.placeId, p.place, town)}
          className={CHIP}
          rel={p.site ? undefined : "nofollow"}
        >
          <Icon name="cup" size={20} /> {p.site ? "Their site" : "On the map"}
        </a>
      </div>
    </li>
  );
}
