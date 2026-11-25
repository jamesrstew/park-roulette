import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { Suspense } from "react";
import { attrIcon, Icon } from "@/components/icons";
import { CrayonLoading } from "@/components/Loading";
import { SignupStrip } from "@/components/social/SignupStrip";
import { SocialTracker } from "@/components/social/SocialTracker";
import { longDate } from "@/lib/events/model";
import { statusOn } from "@/lib/events/model";
import { allEvents } from "@/lib/events/store";
import { CATALOG } from "@/lib/news/catalog";
import { publicParks } from "@/lib/seo-data";
import { NOINDEX, SITE_URL } from "@/lib/site";
import {
  destinationOf,
  hasPostPage,
  isGridKind,
  KIND_LABEL,
  mediaSrc,
} from "@/lib/social/links";
import { COPY } from "@/lib/social/model";
import {
  atHomeIdeas,
  headlineOf,
  type Lookups,
  mashupPairs,
  type PageItem,
  type PagePair,
  stateLine,
  unpackItems,
} from "@/lib/social/post-page";
import { outDay, withFrom } from "@/lib/social/links";
import { carryFrom } from "@/lib/social/sources";
import { type PublicPost, socialPost } from "@/lib/social/public";

/**
 * One post's page (/social/<id>), for the posts with several places in
 * them: Unpack (each item with its event, park or venue link), the park
 * pairings (each place and park, with the park's page and the place's own
 * site or its Google Maps page) and at home (the ideas, readable, then the
 * Thursday email). Every other post has one
 * place, so its address goes straight there (the grid links there too).
 *
 * noindex: the words are the post's own, already on Instagram, and the
 * places it links to are the pages worth finding. The canonical is still
 * this page (no ?from=), and the share picture is the post's cover.
 */

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const idOf = (raw: string) => (/^\d{1,9}$/.test(raw) ? Number(raw) : null);

async function load(raw: string): Promise<PublicPost | null> {
  const id = idOf(raw);
  return id ? socialPost(id) : null;
}

function describe(p: PublicPost): string {
  if (p.kind === "mashup")
    return "Each place and the park beside it, with a link to each.";
  if (p.kind === "at_home")
    return `${atHomeIdeas(p.spec.slides).length} things to try at home with Central Oregon kids, step by step.`;
  return "Every place from our post, with a link to each.";
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const post = await load((await params).id);
  if (!post) return { title: "Lost post", ...NOINDEX };
  const title = post.spec.headline || KIND_LABEL[post.kind as "unpack"];
  const cover = post.media[0];
  return {
    title,
    description: describe(post),
    alternates: { canonical: `/social/${post.id}` },
    ...NOINDEX,
    openGraph: {
      title,
      description: describe(post),
      type: "website",
      images: [
        {
          url: `${SITE_URL}${mediaSrc(cover)}`,
          width: cover.width,
          height: cover.height,
          alt: cover.alt,
        },
      ],
    },
  };
}

/** The post's slides, small and swipeable, so it's the one they saw. */
function SlideStrip({ post }: { post: PublicPost }) {
  return (
    <ul
      aria-label="The post's slides"
      className="-mx-4 flex snap-x snap-mandatory [scrollbar-width:thin] gap-2 overflow-x-auto px-4 pb-2"
    >
      {post.media.map((m, i) => (
        <li key={`${m.sha}-${i}`} className="shrink-0 snap-start">
          <Image
            src={mediaSrc(m)}
            alt={m.alt}
            width={m.width}
            height={m.height}
            sizes="128px"
            loading={i < 3 ? "eager" : "lazy"}
            className="h-40 w-32 rounded-md border-2 border-ink object-cover"
          />
        </li>
      ))}
    </ul>
  );
}

function Title({ post }: { post: PublicPost }) {
  const h = headlineOf(post.spec.slides);
  return (
    <header className="flex flex-col gap-1 pt-2">
      <Link
        href="/social"
        className="flex min-h-11 items-center gap-1 self-start font-hand text-lg underline"
      >
        <Icon name="arrow_left" size={20} /> All our posts
      </Link>
      <p className="font-hand text-lg text-ink-soft">
        {KIND_LABEL[post.kind as "unpack"]} · {longDate(outDay(post))}
      </p>
      <h1 className="text-4xl text-balance">
        {h ? (
          <Highlighted words={h.words} word={h.highlight} />
        ) : (
          post.spec.headline
        )}
      </h1>
    </header>
  );
}

/** The headline with its one highlighted word, as the slide drew it. */
function Highlighted({ words, word }: { words: string; word: string }) {
  const key = (w: string) => w.toLowerCase().replace(/[^a-z0-9'-]/g, "");
  const parts = words.split(/(\s+)/);
  const at = parts.findIndex((w) => key(w) === key(word));
  return (
    <>
      {parts.map((w, i) =>
        i === at ? (
          <span key={i} className="highlight">
            {w}
          </span>
        ) : (
          w
        ),
      )}
    </>
  );
}

function ItemCard({ it, from }: { it: PageItem; from: string | null }) {
  const state = stateLine(it.state);
  const gone = it.state !== "ok" && it.state !== "rescheduled";
  return (
    <li className="doodle-box flex flex-col gap-2 px-4 py-3">
      <div className="flex items-start gap-3">
        <span className="font-hand text-3xl leading-none text-crayon-orange">
          {it.n}
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <h2
            className={`text-2xl leading-tight ${gone ? "line-through decoration-2" : ""}`}
          >
            {it.name}
          </h2>
          {state ? (
            <p className="self-start rounded-md bg-crayon-red px-2 font-hand text-lg text-white">
              {state}
            </p>
          ) : null}
          <p className="leading-snug">{it.what}</p>
          {it.state === "removed" ? (
            <Link
              href="/events"
              data-social="events"
              className="text-sm underline"
            >
              See what&apos;s on this week instead
            </Link>
          ) : null}
          {it.place ? (
            <p className="text-sm leading-snug text-ink-soft">
              {it.place}
              {it.host ? `. Hosted by ${it.host}` : ""}
            </p>
          ) : null}
          {it.facts.length ? (
            <p className="text-sm leading-snug text-ink-soft">
              {it.facts.join(" · ")}
            </p>
          ) : null}
        </div>
      </div>
      {it.link ? (
        it.link.external ? (
          <a
            href={it.link.href}
            target="_blank"
            rel="noopener noreferrer"
            data-social={it.link.to}
            className="crayon-btn wax min-h-12 self-stretch bg-crayon-yellow text-xl"
          >
            {it.link.label} <Icon name="arrow_right" size={22} />
          </a>
        ) : (
          <Link
            href={withFrom(it.link.href, from)}
            data-social={it.link.to}
            className="crayon-btn wax min-h-12 self-stretch bg-crayon-yellow text-xl"
          >
            {it.link.label} <Icon name="arrow_right" size={22} />
          </Link>
        )
      ) : null}
    </li>
  );
}

async function lookups(): Promise<Lookups> {
  const [events, parks] = await Promise.all([allEvents(), publicParks()]);
  const bySlug = new Map(events.map((e) => [e.slug, e]));
  const parkBySlug = new Map(parks.map((p) => [p.slug, p]));
  const venues = new Map(CATALOG.venues.map((v) => [v.id, v]));
  return {
    venue: (id) => {
      const v = venues.get(id);
      return v ? { name: v.name, url: v.url } : null;
    },
    event: (slug, day) => {
      const e = bySlug.get(slug);
      if (!e) return null;
      const st = statusOn(e.data, day, e.status);
      return { title: e.data.title, status: st === "scheduled" ? "ok" : st };
    },
    park: (slug) => {
      const p = parkBySlug.get(slug);
      return p ? { name: p.name } : null;
    },
  };
}

async function Unpack({
  post,
  from,
}: {
  post: PublicPost;
  from: string | null;
}) {
  const items = unpackItems(post.spec.slides, post.body, await lookups());
  return (
    <ol className="flex flex-col gap-4" aria-label="In this post">
      {items.map((it) => (
        <ItemCard key={it.n} it={it} from={from} />
      ))}
    </ol>
  );
}

function PairCard({ p, from }: { p: PagePair; from: string | null }) {
  return (
    <li className="doodle-box flex flex-col gap-2 px-4 py-3">
      <div className="flex items-start gap-3">
        <span className="font-hand text-3xl leading-none text-crayon-orange">
          {p.n}
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-2xl leading-tight">
            {p.place} <span className="text-crayon-red">+</span> {p.park}
          </h2>
          <p className="text-sm leading-snug text-ink-soft">
            {p.town} · {p.apart.toLowerCase()} apart
          </p>
          <p className="leading-snug">
            <b className="font-semibold">{p.label}:</b> {p.trait}
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {p.anchorLink ? (
          p.anchorLink.external ? (
            <a
              href={p.anchorLink.href}
              target="_blank"
              rel="noopener noreferrer"
              data-social={p.anchorLink.to}
              className="crayon-btn wax min-h-12 self-stretch bg-crayon-yellow text-xl"
            >
              {p.anchorLink.label} <Icon name="arrow_right" size={22} />
            </a>
          ) : (
            <Link
              href={withFrom(p.anchorLink.href, from)}
              data-social={p.anchorLink.to}
              className="crayon-btn wax min-h-12 self-stretch bg-crayon-yellow text-xl"
            >
              {p.anchorLink.label} <Icon name="arrow_right" size={22} />
            </Link>
          )
        ) : null}
        <a
          href={p.placeLink.href}
          target="_blank"
          rel="noopener noreferrer"
          data-social={p.placeLink.to}
          className="crayon-btn wax min-h-12 self-stretch bg-crayon-blue text-xl text-white"
        >
          {p.placeLink.label} <Icon name="arrow_right" size={22} />
        </a>
      </div>
    </li>
  );
}

async function Mashup({
  post,
  from,
}: {
  post: PublicPost;
  from: string | null;
}) {
  const L = await lookups();
  const pairs = mashupPairs(post.spec.slides, L);
  return (
    <>
      <ol className="flex flex-col gap-4" aria-label="In this post">
        {pairs.map((p) => (
          <PairCard key={p.n} p={p} from={from} />
        ))}
      </ol>
      <p className="text-sm text-ink-soft">{COPY.mashupHours}</p>
    </>
  );
}

function AtHome({ post }: { post: PublicPost }) {
  const ideas = atHomeIdeas(post.spec.slides);
  return (
    <ol className="flex flex-col gap-4" aria-label="The ideas">
      {ideas.map((i) => (
        <li key={i.n} className="doodle-box flex flex-col gap-2 px-4 py-3">
          <div className="flex items-center gap-3">
            <Icon name={attrIcon(i.icon)} size={40} />
            <div>
              <h2 className="text-3xl leading-none">{i.title}</h2>
              <p className="font-hand text-lg text-ink-soft">{i.ages}</p>
            </div>
          </div>
          <p className="leading-snug">
            <b className="font-semibold">You need:</b> {i.need}
          </p>
          <ol className="flex list-decimal flex-col gap-1 pl-6 leading-snug">
            {i.steps.map((s, n) => (
              <li key={n}>{s}</li>
            ))}
          </ol>
          {i.payoff ? (
            <p className="leading-snug">
              <span className="highlight font-semibold">
                {COPY.payoffLabel}:
              </span>{" "}
              {i.payoff}
            </p>
          ) : null}
          {i.safety ? (
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Icon name="heart" size={20} /> {i.safety}
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

async function Post({ params, searchParams }: Props) {
  const raw = (await params).id;
  const post = await load(raw);
  if (!post || !isGridKind(post.kind)) notFound();
  if (!hasPostPage(post.kind)) {
    // One place: the address goes straight there (keeps ?from=).
    const dest = destinationOf(post);
    if (!dest) notFound();
    const from = (await searchParams).from;
    permanentRedirect(withFrom(dest.href, carryFrom(from)));
  }
  return (
    <>
      <Title post={post} />
      <SlideStrip post={post} />
      <SocialTracker source="social_post" className="flex flex-col gap-5">
        {post.kind === "unpack" ? (
          <Unpack post={post} from={carryFrom((await searchParams).from)} />
        ) : post.kind === "mashup" ? (
          <Mashup post={post} from={carryFrom((await searchParams).from)} />
        ) : (
          <AtHome post={post} />
        )}
        <section className="flex flex-col gap-2">
          <h2 className="font-hand text-3xl">
            {post.kind === "at_home" ? "Ready to get out?" : "Next week's plan"}
          </h2>
          <Suspense fallback={<div className="h-[9.5rem]" aria-hidden />}>
            <Strip searchParams={searchParams} kind={post.kind} />
          </Suspense>
          <Link
            href="/social"
            className="flex min-h-11 items-center gap-2 font-hand text-xl underline"
          >
            <Icon name="star" size={24} /> More of our posts
          </Link>
        </section>
      </SocialTracker>
    </>
  );
}

async function Strip({
  searchParams,
  kind,
}: Pick<Props, "searchParams"> & { kind: string }) {
  const from = (await searchParams).from;
  return (
    <SignupStrip
      from={from}
      pitch={
        kind === "at_home"
          ? "The weekend forecast and one park plan, for when you're ready to get out."
          : "The weekend forecast and one park plan."
      }
    />
  );
}

export default function SocialPostPage(props: Props) {
  return (
    <div className="flex flex-col gap-5 pb-32">
      <Suspense fallback={<CrayonLoading label="One sec…" />}>
        <Post {...props} />
      </Suspense>
    </div>
  );
}
