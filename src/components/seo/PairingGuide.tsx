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
}: {
  v: PairingGuideView;
  /** The other pairing guides that exist now (links at the foot). */
  existing: readonly string[];
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
            <PairCard key={p.placeId} p={p} n={i + 1} />
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
      <nav
        aria-label="More guides"
        className="text-center text-sm leading-relaxed"
      >
        More guides:{" "}
        {others.map((g, i) => (
          <span key={g.slug}>
            {i > 0 && " · "}
            <Link href={pairingGuidePath(g.slug)} className="underline">
              {g.name}
            </Link>
          </span>
        ))}
        {others.length ? " · " : ""}
        {GUIDES.filter((g) =>
          v.def.rainy
            ? g.slug === "indoor-play-bend"
            : g.slug === "sledding-hills-bend",
        ).map((g) => (
          <span key={g.slug}>
            <Link href={guidePath(g.slug)} className="underline">
              {g.name}
            </Link>
            {" · "}
          </span>
        ))}
        <Link href="/guides" className="underline">
          All guides
        </Link>
      </nav>
      <p className="text-center text-sm leading-snug text-ink">
        Places come from their own sites and Google Maps; park details from park
        pages and local families.
      </p>
    </article>
  );
}

const CHIP =
  "inline-flex min-h-11 items-center gap-1.5 rounded-[12px_14px_10px_16px] border-2 border-ink bg-white/70 px-3 text-[0.95rem]";

function PairCard({ p, n }: { p: GuidePair; n: number }) {
  const external = !p.anchorHref.startsWith("/");
  const anchorIcon = p.anchorKind === "park" ? "playground" : "home";
  return (
    <li className="doodle-box flex flex-col gap-2 px-4 py-3">
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
            <Icon name={anchorIcon} size={20} /> Their page
          </a>
        ) : (
          <Link href={p.anchorHref} className={CHIP}>
            <Icon name={anchorIcon} size={20} /> See the park
          </Link>
        )}
        <a
          href={p.site ?? mapsHref(p.placeId)}
          className={CHIP}
          rel={p.site ? undefined : "nofollow"}
        >
          <Icon name="cup" size={20} /> {p.site ? "Their site" : "On the map"}
        </a>
      </div>
    </li>
  );
}
