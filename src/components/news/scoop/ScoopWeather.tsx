import Link from "next/link";
import { WeatherGlyph } from "@/components/news/WeatherCard";
import {
  daySentence,
  roughDay,
  roughLine,
  type ScoopDay,
  shortCondition,
} from "@/lib/scoop";

/**
 * Next 3 days in Bend: the email card's hand-drawn icons, a short
 * condition word, the high (big) and low (soft). A disruptive day
 * (tiers.ts) gets a dashed outline and one row pointing at indoor events.
 */
export function ScoopWeather({ days }: { days: ScoopDay[] }) {
  const rough = roughDay(days);
  return (
    <section aria-labelledby="scoop-weather-h" className="flex flex-col gap-2">
      <h2 id="scoop-weather-h" className="font-hand text-2xl leading-none">
        Next 3 days in Bend
      </h2>
      <div className="doodle-box grid h-[8.25rem] grid-cols-3 px-1 py-2">
        {days.map((d) => (
          <div
            key={d.date}
            className={`flex flex-col items-center justify-between rounded-2xl px-1 text-center ${
              d.tier === "disruptive"
                ? "border-2 border-dashed border-crayon-orange"
                : ""
            }`}
          >
            <p className="sr-only">{daySentence(d)}</p>
            <p aria-hidden className="font-hand text-xl leading-none">
              {d.label}
            </p>
            <span aria-hidden>
              <WeatherGlyph icon={d.icon} size={44} />
            </span>
            <p aria-hidden className="font-hand leading-none">
              <span className="text-2xl">{d.high}°</span>
              {d.low != null ? (
                <span className="text-lg text-ink-soft"> / {d.low}°</span>
              ) : null}
            </p>
            <p
              aria-hidden
              className="w-full truncate text-[0.8rem] leading-tight text-ink-soft"
            >
              {d.pop != null && d.pop >= 20 ? (
                <span className="font-semibold text-crayon-blue">
                  {d.pop}%{" "}
                </span>
              ) : null}
              {shortCondition(d.condition)}
            </p>
          </div>
        ))}
      </div>
      {rough ? (
        <Link
          href="/events?setting=indoor"
          data-scoop="indoor"
          className="flex min-h-11 items-center gap-2 leading-snug"
        >
          <span aria-hidden className="shrink-0">
            <WeatherGlyph icon={rough.icon} size={28} />
          </span>
          <span>
            {roughLine(rough)}{" "}
            <span className="underline underline-offset-2">
              Try an indoor event
            </span>{" "}
            <span aria-hidden>→</span>
          </span>
        </Link>
      ) : null}
    </section>
  );
}
