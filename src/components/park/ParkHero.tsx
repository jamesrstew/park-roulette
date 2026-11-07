import { CRAYONS, townCrayon } from "@/lib/crayons";
import { Stars } from "../Stars";
import { Underline } from "../Scribbles";
import { BackButton } from "./BackButton";
import { DoodleScene } from "./Doodles";
import { formatDay, plural } from "./format";

export function ParkHero({
  name,
  city,
  avgTenths,
  reviewCount,
  cover,
  lastVisit,
  visitCount,
  signedIn,
  crossedOff,
  notes,
  playground = true,
}: {
  notes: string | null;
  /** False for a park without a playground (changes the doodle). */
  playground?: boolean;
  name: string;
  city: string;
  avgTenths: number | null;
  reviewCount: number;
  cover: string | null;
  lastVisit: string | null;
  visitCount: number;
  signedIn: boolean;
  crossedOff: boolean;
}) {
  const town = CRAYONS[townCrayon(city)];
  return (
    <header className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <BackButton />
        <span
          className="chip wax text-ink"
          style={{ backgroundColor: town }}
          title={`${city}, Oregon`}
        >
          📍 {city}
        </span>
      </div>

      {/* Polaroid, taped to the page */}
      <div className="relative mx-auto mt-2 w-[92%] -rotate-2">
        <span className="tape -top-3 left-1/2 z-10 -translate-x-1/2 rotate-3" />
        <div className="border-2 border-ink/80 bg-white p-2.5 pb-3 shadow-[3px_5px_0_rgb(43_42_51/0.25)]">
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element -- Blob URLs, no image optimizer
            <img
              src={cover}
              alt={`A photo of ${name}`}
              className="aspect-[4/3] w-full object-cover"
            />
          ) : (
            <DoodleScene
              className="aspect-[4/3] w-full"
              playground={playground}
            />
          )}
          <p
            className={`pt-2 font-hand text-lg leading-none text-ink-soft ${signedIn ? "pr-24 pl-1 text-left" : "text-center"}`}
          >
            {cover ? "snapped by a critic" : "no photos yet!"}
          </p>
        </div>
        {signedIn && (
          <VisitStamp
            lastVisit={lastVisit}
            visitCount={visitCount}
            crossedOff={crossedOff}
          />
        )}
      </div>

      <div className="mt-1 text-center">
        <h1
          className={`font-hand text-[2.6rem] leading-[0.95] text-balance ${crossedOff ? "text-ink-soft" : ""}`}
        >
          {name}
        </h1>
        <Underline className="mx-auto mt-0.5 h-3.5 w-48" color={town} />
        {notes && (
          <p className="mx-auto mt-2 max-w-sm font-hand text-xl leading-snug text-balance">
            &ldquo;{notes}&rdquo;
          </p>
        )}
        <div className="mt-2 flex items-center justify-center gap-2">
          {avgTenths == null ? (
            <a
              href="#review"
              className="font-hand text-xl text-ink-soft underline decoration-dashed underline-offset-4"
            >
              No stars yet. Be the first critic!
            </a>
          ) : (
            <>
              <Stars tenths={avgTenths} size={24} />
              <a
                href="#reviews"
                className="font-hand text-lg text-ink-soft underline decoration-dashed underline-offset-4"
              >
                {plural(reviewCount, "review")}
              </a>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

/** A rubber stamp slapped on the corner of the polaroid. */
function VisitStamp({
  lastVisit,
  visitCount,
  crossedOff,
}: {
  lastVisit: string | null;
  visitCount: number;
  crossedOff: boolean;
}) {
  if (lastVisit) {
    return (
      <div
        className="absolute -right-2 -bottom-5 flex h-[6.2rem] w-[6.2rem] rotate-[-14deg] animate-pop-in flex-col items-center justify-center rounded-full border-[3px] border-double border-crayon-red bg-[#fffdf7]/90 text-crayon-red shadow-[2px_3px_0_rgb(43_42_51/0.2)]"
        aria-label={`Stamped ${formatDay(lastVisit)}`}
      >
        <span className="font-hand text-sm leading-none tracking-[0.2em] uppercase">
          Stamped
        </span>
        <span className="font-hand text-[1.35rem] leading-tight">
          {formatDay(lastVisit).replace(/, \d{4}$/, "")}
        </span>
        <span className="text-base leading-none">
          ✅{visitCount > 1 ? ` ×${visitCount}` : ""}
        </span>
      </div>
    );
  }
  if (crossedOff) return null;
  return (
    <div className="absolute -right-1 -bottom-4 flex h-[5.4rem] w-[5.4rem] rotate-[10deg] flex-col items-center justify-center rounded-full border-[2.5px] border-dashed border-ink-soft/70 bg-[#fffdf7]/90 text-ink-soft">
      <span className="font-hand text-sm leading-none">not yet!</span>
      <span className="text-2xl leading-tight">🗺️</span>
    </div>
  );
}
