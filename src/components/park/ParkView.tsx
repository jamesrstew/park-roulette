import type { getParkDetail, Me } from "@/lib/data";
import { Icon } from "@/components/icons";
import { isCrossedOff, playOf } from "@/lib/features";
import { averageTenths } from "@/lib/rating";
import { CrossedOffBanner, CrossOffFooter, PlaySign } from "./CrossOff";
import { MyReview } from "./MyReview";
import { ParkActions } from "./ParkActions";
import { ParkHero } from "./ParkHero";
import { ReportCard } from "./ReportCard";
import { ReviewCard } from "./ReviewCard";

type Detail = NonNullable<Awaited<ReturnType<typeof getParkDetail>>>;

export function ParkView({
  detail,
  me,
  justAdded,
}: {
  detail: Detail;
  me: Me | null;
  justAdded: boolean;
}) {
  const { park, reviews, myVisits } = detail;
  const signedIn = !!me;
  const crossedOff = isCrossedOff(park);
  const play = playOf(park);
  const mine = me
    ? (reviews.find((r) => r.explorer.id === me.id) ?? null)
    : null;
  const others = reviews.filter((r) => r !== mine);
  const avg = averageTenths(reviews.map((r) => r.ratingTenths));
  const cover =
    reviews.flatMap((r) => r.media).find((m) => m.kind === "image")?.url ??
    null;

  const reports: Record<string, number> = {};
  for (const r of reviews)
    for (const t of new Set(r.tags)) reports[t] = (reports[t] ?? 0) + 1;

  return (
    <div className="flex flex-col gap-7">
      {justAdded && (
        <p className="doodle-box flex animate-pop-in items-center gap-2 bg-[color-mix(in_srgb,var(--color-crayon-green)_14%,#fffdf7)] px-4 py-3 font-hand text-xl">
          <Icon name="party" size={32} />
          It&apos;s on the map! Thanks for adding it, explorer.
        </p>
      )}

      {crossedOff && (
        <CrossedOffBanner
          parkId={park.id}
          status={park.status}
          statusNote={park.statusNote}
          signedIn={signedIn}
        />
      )}

      <ParkHero
        name={park.name}
        city={park.city}
        avgTenths={avg}
        reviewCount={reviews.length}
        cover={cover}
        lastVisit={myVisits[0]?.visitedOn ?? null}
        visitCount={myVisits.length}
        signedIn={signedIn}
        crossedOff={crossedOff}
        notes={park.notes?.trim() || null}
        playground={play !== "none"}
      />

      <ParkActions
        park={{
          id: park.id,
          name: park.name,
          city: park.city,
          lat: park.lat,
          lng: park.lng,
        }}
        signedIn={signedIn}
        visits={myVisits}
        hasMyReview={!!mine}
      />

      {!crossedOff && (
        <PlaySign parkId={park.id} play={play} signedIn={signedIn} />
      )}

      <ReportCard
        parkId={park.id}
        features={park.features}
        confidence={park.confidence}
        reports={reports}
        signedIn={signedIn}
      />

      <section
        id="reviews"
        aria-labelledby="reviews-h"
        className="flex scroll-mt-6 flex-col gap-4"
      >
        <h2
          id="reviews-h"
          className="flex items-center gap-2 font-hand text-3xl"
        >
          <Icon name="crayon" size={32} /> Critics&apos; corner{" "}
          {reviews.length > 0 && (
            <span className="text-xl text-ink-soft">({reviews.length})</span>
          )}
        </h2>
        <MyReview
          parkId={park.id}
          parkFeatures={park.features}
          review={mine}
          signedIn={signedIn}
          firstCritic={reviews.length === 0}
          startOpen={myVisits.length > 0}
        />
        {others.map((r, i) => (
          <ReviewCard key={r.id} review={r} alt={i % 2 === 0} />
        ))}
      </section>

      {!crossedOff && (
        <CrossOffFooter parkId={park.id} play={play} signedIn={signedIn} />
      )}
    </div>
  );
}
