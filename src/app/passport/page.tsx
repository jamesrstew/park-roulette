import type { Metadata } from "next";
import Link from "next/link";
import { AvatarBlob } from "@/components/me/NameTag";
import { NOINDEX } from "@/lib/site";
import { Suspense } from "react";
import { CrayonLoading } from "@/components/Loading";
import { todayInBend, SectionTitle } from "@/components/passport/bits";
import { PageTitle } from "@/components/PageTitle";
import { Cover } from "@/components/passport/Cover";
import { FunStats } from "@/components/passport/FunStats";
import { SignedOut } from "@/components/passport/SignedOut";
import { StickerBook } from "@/components/passport/StickerBook";
import { Stamps, type StampView } from "@/components/passport/Stamps";
import { Towns } from "@/components/passport/Towns";
import { computeBadges, computeStats, progressOf } from "@/lib/badges";
import { getMe } from "@/lib/data";
import { adminQueueSize } from "@/lib/data-admin";
import { getPassportData } from "@/lib/data-passport";
import { ATTRIBUTES, hasPlayground } from "@/lib/features";

export const metadata: Metadata = { title: "Passport", ...NOINDEX };

const HEADS_UP = Object.entries(ATTRIBUTES)
  .filter(([, a]) => a.kind === "heads_up")
  .map(([k]) => k);

async function Passport() {
  const me = await getMe();
  if (!me) return <SignedOut />;

  const [data, adminQueue] = await Promise.all([
    getPassportData(me.crew.id),
    me.isAdmin && me.trusted ? adminQueueSize() : Promise.resolve(0),
  ]);
  const now = new Date();
  const visitedIds = new Set(data.visits.map((v) => v.parkId));
  const progress = progressOf(data.parks, visitedIds);
  const every = progressOf(data.parks, visitedIds, "every");
  // Towns count the playground quest, same as the Towns section.
  const playgrounds = data.parks.filter(hasPlayground);
  const towns = new Set(playgrounds.map((p) => p.city));
  const townsExplored = new Set(
    playgrounds.filter((p) => visitedIds.has(p.id)).map((p) => p.city),
  ).size;

  // One stamp per park, newest visit first (visits arrive newest first).
  const parkById = new Map(data.parks.map((p) => [p.id, p]));
  const stampMap = new Map<number, StampView>();
  for (const v of data.visits) {
    const s = stampMap.get(v.parkId);
    if (s) {
      s.times++;
      continue;
    }
    const p = parkById.get(v.parkId);
    if (!p) continue;
    stampMap.set(v.parkId, {
      parkId: p.id,
      slug: p.slug,
      name: p.name,
      city: p.city,
      visitedOn: v.visitedOn,
      times: 1,
    });
  }

  const badges = computeBadges({
    parks: data.parks,
    visits: data.visits,
    reviews: data.reviews,
    photoCount: data.photoCount,
    headsUpKeys: HEADS_UP,
  });
  const earned = badges.filter((b) => b.earned).length;
  const stats = computeStats({
    visits: data.visits,
    reviews: data.reviews,
    members: data.members,
    parks: data.parks,
    today: todayInBend(now),
  });

  return (
    <div className="flex flex-col gap-6 pt-1">
      <Link
        href="/me"
        className="doodle-box-alt -mb-2 flex min-h-12 items-center gap-3 self-end py-1.5 pr-3 pl-2 transition-transform active:scale-95"
      >
        <span className="relative">
          <AvatarBlob avatar={me.avatar} color={me.color} size="sm" />
          {adminQueue > 0 && (
            <span className="absolute -top-1 -right-1 grid h-5 min-w-5 place-items-center rounded-full border-2 border-ink bg-crayon-red px-1 text-xs text-white">
              {adminQueue}
              <span className="sr-only"> things for the admin to look at</span>
            </span>
          )}
        </span>
        <span className="font-hand text-lg leading-tight">
          {me.name}
          <span className="block text-xs text-ink-soft">
            Family &amp; settings
          </span>
        </span>
        <span aria-hidden className="font-hand text-2xl">
          ›
        </span>
      </Link>
      <PageTitle
        lead="Our"
        accent="Passport"
        color="purple"
        underline="orange"
        underlineWidth="w-44"
      />
      <Cover
        crew={data.crew}
        members={data.members}
        progress={progress}
        every={every}
        townsTotal={towns.size}
      />
      <Stamps stamps={[...stampMap.values()]} />
      <section aria-labelledby="stickers-h">
        <SectionTitle
          icon="sparkles"
          color="#ee6aa7"
          aside={
            <span className="pb-2 font-hand text-lg text-ink-soft">
              {earned} of {badges.length}
            </span>
          }
        >
          <span id="stickers-h">Sticker book</span>
        </SectionTitle>
        <div className="doodle-box-alt px-2 pt-5 pb-4">
          <StickerBook badges={badges} crewId={me.crew.id} />
        </div>
      </section>
      <Towns parks={data.parks} visitedIds={visitedIds} />
      <FunStats
        stats={stats}
        members={data.members}
        townsExplored={townsExplored}
        townsTotal={towns.size}
      />
    </div>
  );
}

export default function PassportPage() {
  return (
    <Suspense fallback={<CrayonLoading label="Opening the passport…" />}>
      <Passport />
    </Suspense>
  );
}
