import Link from "next/link";
import { Icon } from "@/components/icons";
import { crayon, townCrayon } from "@/lib/crayons";
import { SectionTitle, stampDate, tilt } from "./bits";

export type StampView = {
  parkId: number;
  slug: string;
  name: string;
  city: string;
  /** Latest visit. */
  visitedOn: string;
  times: number;
};

const SHOWN = 12;
const SHAPES = [
  "rounded-full",
  "rounded-[10px]",
  "rounded-[40%_40%_12px_12px]",
] as const;

function Stamp({ s, i }: { s: StampView; i: number }) {
  const color = crayon(townCrayon(s.city));
  const shape = SHAPES[s.parkId % SHAPES.length];
  return (
    <li>
      <Link
        href={`/parks/${s.slug}`}
        aria-label={`${s.name}, ${s.city}, ${stampDate(s.visitedOn)}`}
        className="group relative block aspect-square"
      >
        <div
          className={`absolute inset-0.5 flex flex-col items-center justify-center border-[3px] px-2.5 py-2 text-center mix-blend-multiply transition-transform group-active:scale-95 ${shape}`}
          style={{
            borderColor: color,
            color,
            transform: `rotate(${tilt(s.parkId + i * 0.1, 9)}deg)`,
            filter: "url(#wobble)",
            opacity: 0.92,
          }}
        >
          <div
            className={`pointer-events-none absolute inset-1 border-[1.5px] border-dashed ${shape}`}
            style={{ borderColor: color }}
          />
          <span className="max-w-full truncate text-[0.58rem] font-bold tracking-[0.12em] uppercase">
            {s.city}
          </span>
          <span className="line-clamp-3 font-hand text-[0.98rem] leading-[1.02]">
            {s.name}
          </span>
          <span className="mt-0.5 font-hand text-[0.85rem] tracking-wide uppercase">
            {stampDate(s.visitedOn)}
          </span>
        </div>
        {s.times > 1 && (
          <span className="absolute -top-1 -right-1 rounded-full border-2 border-ink bg-crayon-yellow px-1.5 font-hand text-sm leading-5 shadow-[1px_1px_0_#2b2a33]">
            ×{s.times}
          </span>
        )}
      </Link>
    </li>
  );
}

export function Stamps({ stamps }: { stamps: StampView[] }) {
  const first = stamps.slice(0, SHOWN);
  const rest = stamps.slice(SHOWN);
  return (
    <section aria-labelledby="stamps-h">
      <SectionTitle
        icon="stamp"
        color="#e5432f"
        aside={
          stamps.length > 0 && (
            <span className="pb-2 font-hand text-lg text-ink-soft">
              {stamps.length} stamp{stamps.length === 1 ? "" : "s"}
            </span>
          )
        }
      >
        <span id="stamps-h">Stamps</span>
      </SectionTitle>

      {stamps.length === 0 ? (
        <EmptyStamps />
      ) : (
        <div className="doodle-box [background-image:repeating-linear-gradient(0deg,transparent_0_27px,#2f78d41a_27px_28px)] px-3 py-4">
          <ul className="grid grid-cols-3 gap-3">
            {first.map((s, i) => (
              <Stamp key={s.parkId} s={s} i={i} />
            ))}
          </ul>
          {rest.length > 0 && (
            <details className="group mt-3">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-center font-hand text-xl text-crayon-blue [&::-webkit-details-marker]:hidden">
                <span className="group-open:hidden">
                  Flip the page: {rest.length} more →
                </span>
                <span className="hidden group-open:inline">Show fewer</span>
              </summary>
              <ul className="mt-2 grid grid-cols-3 gap-3">
                {rest.map((s, i) => (
                  <Stamp key={s.parkId} s={s} i={i + SHOWN} />
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}

function EmptyStamps() {
  return (
    <div className="doodle-box flex flex-col items-center gap-4 px-4 py-6 text-center">
      <div className="grid w-full grid-cols-3 gap-3">
        <div className="relative col-span-1 flex aspect-square -rotate-6 items-center justify-center rounded-full border-[3px] border-dashed border-crayon-red/70 p-2">
          <span className="font-hand text-[1rem] leading-tight text-crayon-red">
            Your first stamp goes here!
          </span>
        </div>
        <div className="aspect-square rotate-3 rounded-[10px] border-2 border-dashed border-ink/15" />
        <div className="aspect-square -rotate-2 rounded-[40%_40%_12px_12px] border-2 border-dashed border-ink/15" />
      </div>
      <p className="font-hand text-xl text-ink-soft">
        Go play somewhere, tap <span className="highlight">We went!</span>, and
        it lands here.
      </p>
      <Link href="/" className="crayon-btn wax bg-crayon-yellow">
        <Icon name="spin" size={28} /> Spin the wheel
      </Link>
    </div>
  );
}
