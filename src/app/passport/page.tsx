import type { Metadata } from "next";
import { Suspense } from "react";
import { CrayonLoading } from "@/components/Loading";
import { todayInBend, SectionTitle } from "@/components/passport/bits";
import { Cover } from "@/components/passport/Cover";
import { FreshScribbles } from "@/components/passport/FreshScribbles";
import { FunStats } from "@/components/passport/FunStats";
import { SignedOut } from "@/components/passport/SignedOut";
import { StickerBook } from "@/components/passport/StickerBook";
import { Stamps, type StampView } from "@/components/passport/Stamps";
import { Towns } from "@/components/passport/Towns";
import { computeBadges, computeStats, progressOf } from "@/lib/badges";
import { getMe, getRecentReviews } from "@/lib/data";
import { getPassportData } from "@/lib/data-passport";
import { ATTRIBUTES, hasPlayground } from "@/lib/features";

export const metadata: Metadata = { title: "Passport" };

const HEADS_UP = Object.entries(ATTRIBUTES)
  .filter(([, a]) => a.kind === "heads_up")
  .map(([k]) => k);

async function Passport() {
  const me = await getMe();
  if (!me) return <SignedOut />;

  const [data, recent] = await Promise.all([
    getPassportData(me.crew.id),
    getRecentReviews(6),
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
    <div className="flex flex-col gap-9 pt-1">
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
      <FreshScribbles reviews={recent} now={now.getTime()} />
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
