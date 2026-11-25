import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { Chip } from "@/components/events/EventBits";
import { RegularRow, SpecialRow } from "@/components/events/ProgramBits";
import { Icon } from "@/components/icons";
import { CrayonLoading } from "@/components/Loading";
import { PageTitle } from "@/components/PageTitle";
import { Faq, Section, SpinCta, Updated } from "@/components/seo/Guide";
import { JsonLd } from "@/components/seo/JsonLd";
import { pacificToday } from "@/lib/events/model";
import {
  GUIDES,
  guideJsonLd,
  guidePath,
  type GuideSection,
  type GuideView,
  type ParkItem,
  type VenueItem,
} from "@/lib/guides";
import { loadGuide } from "@/lib/guides-data";
import { pairingGuideDef, pairingGuidePath } from "@/lib/pairing-guides";
import { allPairingGuides, loadPairingGuide } from "@/lib/pairing-guides-data";
import { PairingGuide } from "@/components/seo/PairingGuide";
import { longDate } from "@/lib/seo-data";
import { SITE_URL } from "@/lib/site";

type Props = { params: Promise<{ slug: string }> };

async function load(slug: string) {
  await connection(); // live data, never a build-time snapshot
  const now = new Date();
  return loadGuide(slug, now);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const slug = (await params).slug;
  if (pairingGuideDef(slug)) {
    await connection();
    const p = await loadPairingGuide(slug, new Date());
    if (!p) return { title: "No guide here", robots: { index: false } };
    return {
      title: { absolute: `${p.title} · Park Roulette` },
      description: p.description,
      alternates: { canonical: pairingGuidePath(slug) },
      openGraph: {
        title: p.title,
        description: p.description,
        type: "article",
      },
    };
  }
  const v = await load(slug);
  if (!v) return { title: "No guide here", robots: { index: false } };
  return {
    title: { absolute: `${v.title} · Park Roulette` },
    description: v.description,
    alternates: { canonical: guidePath(v.def.slug) },
    openGraph: { title: v.title, description: v.description, type: "article" },
  };
}

const COLORS = {
  "sledding-hills-bend": { color: "blue", underline: "teal" },
  "holiday-events-central-oregon": { color: "red", underline: "green" },
  "indoor-play-bend": { color: "purple", underline: "yellow" },
  "splash-pads-bend": { color: "teal", underline: "pink" },
} as const;

async function Guide({ params }: Props) {
  const slug = (await params).slug;
  if (pairingGuideDef(slug)) {
    await connection();
    const now = new Date();
    const [p, all] = await Promise.all([
      loadPairingGuide(slug, now),
      allPairingGuides(now),
    ]);
    if (!p) notFound();
    return <PairingGuide v={p} existing={all.map((x) => x.def.slug)} />;
  }
  const v = await load(slug);
  if (!v) notFound();
  const today = pacificToday(new Date());
  const c = COLORS[v.def.slug];
  const others = GUIDES.filter((g) => g.slug !== v.def.slug);
  // The park pairings guide this one leads to, when it exists now.
  const pairing = (await allPairingGuides(new Date())).find((p) =>
    v.def.slug === "indoor-play-bend"
      ? p.def.slug === "rainy-day-cafes-indoor-play-bend"
      : v.def.slug === "sledding-hills-bend"
        ? p.def.slug === "coffee-shops-near-playgrounds-bend"
        : false,
  );
  return (
    <article className="flex flex-col gap-7">
      <JsonLd data={guideJsonLd(v, SITE_URL)} />
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
        lead={v.h1.lead}
        accent={v.h1.accent}
        trail={v.h1.trail}
        color={c.color}
        underline={c.underline}
        underlineWidth="w-48"
        size="text-4xl"
      />
      <p className="doodle-box bg-[color-mix(in_srgb,var(--color-crayon-yellow)_14%,#fffdf7)] p-4 leading-relaxed">
        {v.intro}
      </p>
      <SeasonLine v={v} />
      {pairing && v.def.slug === "indoor-play-bend" ? (
        <p className="flex items-center gap-2 leading-snug">
          <Icon name="cup" size={24} className="shrink-0" />
          <Link href={pairingGuidePath(pairing.def.slug)} className="underline">
            {pairing.def.name}
          </Link>
        </p>
      ) : null}
      {v.updated ? (
        <Updated iso={v.updated} label={longDate(v.updated)} />
      ) : null}

      {v.empty ? (
        <div className="doodle-box flex flex-col items-center gap-3 px-4 py-6 text-center">
          <Icon name="search" size={48} />
          <p className="font-hand text-2xl">{v.empty.line}</p>
          <Link
            href={v.empty.href}
            className="crayon-btn wax min-h-12 bg-crayon-yellow px-5 text-xl"
          >
            {v.empty.label}
          </Link>
        </div>
      ) : null}

      {v.sections.map((s) => (
        <SectionView key={s.id} s={s} today={today} />
      ))}

      {v.faq.length ? (
        <Section title="Questions parents ask" id="faq">
          <Faq items={v.faq} />
        </Section>
      ) : null}

      <SpinCta />

      <nav
        aria-label="More guides"
        className="text-center text-sm leading-relaxed"
      >
        More guides:{" "}
        {others.map((g, i) => (
          <span key={g.slug}>
            {i > 0 && " · "}
            <Link href={guidePath(g.slug)} className="underline">
              {g.name}
            </Link>
          </span>
        ))}
        {pairing ? (
          <>
            {" · "}
            <Link
              href={pairingGuidePath(pairing.def.slug)}
              className="underline"
            >
              {pairing.def.name}
            </Link>
          </>
        ) : null}
        {" · "}
        <Link href="/guides" className="underline">
          All guides
        </Link>
      </nav>
      <p className="text-center text-xs leading-snug text-ink-soft">
        {v.def.slug === "holiday-events-central-oregon" ||
        v.def.slug === "indoor-play-bend"
          ? "Places and events come from their own sites. Plans change, so check before you go."
          : "Park details come from park pages and from local families, and can change. Check when you get there."}
      </p>
    </article>
  );
}

function SeasonLine({ v }: { v: GuideView }) {
  return (
    <p
      className={`flex items-start gap-2 rounded-2xl border-2 border-dashed px-3 py-2 leading-snug ${v.inSeason ? "border-crayon-green bg-[color-mix(in_srgb,var(--color-crayon-green)_10%,#fffdf7)]" : "border-ink/40 bg-white/60"}`}
    >
      <Icon
        name={v.inSeason ? "sun" : "calendar"}
        size={26}
        className="mt-0.5 shrink-0"
      />
      <span>
        {v.seasonNote}
        {v.instead ? (
          <>
            {" "}
            <Link href={v.instead.href} className="underline">
              {v.instead.label}
            </Link>
          </>
        ) : null}
      </span>
    </p>
  );
}

function SectionView({ s, today }: { s: GuideSection; today: string }) {
  if (s.kind === "parks")
    return s.items.length ? (
      <Section title={s.title} id={s.id}>
        <ol className="flex flex-col gap-3">
          {s.items.map((p, i) => (
            <ParkCard key={p.slug} p={p} n={i + 1} />
          ))}
        </ol>
      </Section>
    ) : null;
  if (s.kind === "venues")
    return s.items.length ? (
      <Section title={s.title} id={s.id}>
        <ol className="flex flex-col gap-3">
          {s.items.map((x, i) => (
            <VenueCard key={x.id} v={x} n={i + 1} />
          ))}
        </ol>
      </Section>
    ) : null;
  return (
    <Section title={s.title} id={s.id}>
      {s.programs.length ? (
        <ul className="doodle-box flex flex-col divide-y divide-dashed divide-ink/25 px-3">
          {s.programs.map((p) =>
            s.style === "special" ? (
              <SpecialRow key={p.key} p={p} today={today} level={3} />
            ) : (
              <RegularRow key={p.key} p={p} today={today} />
            ),
          )}
        </ul>
      ) : (
        <p className="leading-snug text-ink-soft">
          Nothing special on the calendar for the next week yet.
        </p>
      )}
      {s.more ? (
        <Link href={s.more.href} className="underline">
          {s.more.label}
        </Link>
      ) : null}
    </Section>
  );
}

function ParkCard({ p, n }: { p: ParkItem; n: number }) {
  return (
    <li className="doodle-box relative flex flex-col gap-1.5 px-4 py-3 focus-within:ring-4 focus-within:ring-crayon-blue/40">
      <h3 className="font-hand text-2xl leading-tight">
        <span className="text-ink-soft">{n}. </span>
        <Link
          href={`/parks/${p.slug}`}
          className="underline decoration-2 underline-offset-4"
        >
          {p.name}
        </Link>
      </h3>
      <p className="text-[0.95rem] text-ink-soft">
        <Link href={p.townHref} className="underline">
          {p.city}
        </Link>
        {p.away ? ` · ${p.away}` : ""}
      </p>
      {p.lines.length ? (
        <ul className="flex flex-col gap-0.5 leading-snug">
          {p.lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      ) : null}
      {p.season || p.has.length ? (
        <div className="flex flex-wrap gap-1.5">
          {p.season ? <Chip tint="free">{p.season}</Chip> : null}
          {p.has.map((h) => (
            <Chip key={h}>{h}</Chip>
          ))}
        </div>
      ) : null}
    </li>
  );
}

function VenueCard({ v, n }: { v: VenueItem; n: number }) {
  return (
    <li className="doodle-box flex flex-col gap-1.5 px-4 py-3">
      <h3 className="font-hand text-2xl leading-tight">
        <span className="text-ink-soft">{n}. </span>
        {v.name}
      </h3>
      <p className="text-[0.95rem] text-ink-soft">
        {v.kind} ·{" "}
        <Link href={v.townHref} className="underline">
          {v.town}
        </Link>
        {v.driveMinutes > 0
          ? ` · ${v.driveMinutes} min drive from downtown Bend`
          : ""}
      </p>
      <p className="leading-snug">{v.what}</p>
      <div className="flex flex-wrap gap-1.5">
        {v.free ? <Chip tint="free">Free</Chip> : null}
        <Chip tint="age">{v.ages}</Chip>
      </div>
      <p className="text-[0.95rem]">
        <a href={v.url} className="underline">
          Their site
        </a>
        {v.hoursUrl ? (
          <>
            {" · "}
            <a href={v.hoursUrl} className="underline">
              Hours
            </a>
          </>
        ) : null}
      </p>
    </li>
  );
}

export default function GuidePage(props: Props) {
  return (
    <Suspense fallback={<CrayonLoading label="Opening the guide…" />}>
      <Guide {...props} />
    </Suspense>
  );
}
