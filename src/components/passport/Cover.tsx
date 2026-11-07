import Link from "next/link";
import { Pines, Sun } from "@/components/Scribbles";
import type { Progress } from "@/lib/badges";
import { crayon } from "@/lib/crayons";

type Member = { id: number; name: string; color: string; avatar: string };

function pct(p: Progress): number {
  if (!p.total) return 0;
  const raw = (p.done / p.total) * 100;
  if (p.done === p.total) return 100;
  return Math.min(99, Math.max(p.done > 0 ? 1 : 0, Math.floor(raw)));
}

/** A big crayon ring: colored-in arc, then a pencil arc for crossed-off parks. */
function Ring({ progress, color }: { progress: Progress; color: string }) {
  const r = 92;
  const c = 2 * Math.PI * r;
  const colored = progress.total
    ? (c * progress.coloredIn) / progress.total
    : 0;
  const crossed = progress.total
    ? (c * progress.crossedOff) / progress.total
    : 0;
  const arc = (len: number, delay: number) => ({
    strokeDasharray: `${len} ${c}`,
    strokeDashoffset: len,
    animation: `draw-in 1.1s ease-out ${delay}s forwards`,
  });
  return (
    <svg viewBox="0 0 240 240" className="h-full w-full" aria-hidden>
      {/* Pencil guide ring */}
      <circle
        cx="120"
        cy="120"
        r={r}
        fill="none"
        stroke="#f6ecd6"
        strokeWidth="24"
      />
      <circle
        cx="120"
        cy="120"
        r={r + 13}
        fill="none"
        stroke="#2b2a33"
        strokeWidth="2"
        filter="url(#wobble)"
      />
      <circle
        cx="120"
        cy="120"
        r={r - 13}
        fill="none"
        stroke="#2b2a33"
        strokeWidth="2"
        filter="url(#wobble)"
      />
      <g transform="rotate(-90 120 120)" strokeLinecap="round" fill="none">
        {colored > 0 && (
          <>
            <circle
              cx="120"
              cy="120"
              r={r}
              stroke={color}
              strokeWidth="20"
              filter="url(#crayon)"
              style={arc(colored, 0.15)}
            />
            <circle
              cx="120"
              cy="120"
              r={r - 4}
              stroke={color}
              strokeOpacity="0.7"
              strokeWidth="6"
              filter="url(#crayon)"
              style={arc(colored, 0.35)}
            />
          </>
        )}
        {crossed > 0 && (
          <g transform={`rotate(${(360 * colored) / c} 120 120)`}>
            <circle
              cx="120"
              cy="120"
              r={r}
              stroke="#5d5a6b"
              strokeOpacity="0.55"
              strokeWidth="9"
              filter="url(#crayon)"
              style={arc(crossed, 1.1)}
            />
          </g>
        )}
      </g>
    </svg>
  );
}

export function Cover({
  crew,
  members,
  progress,
  every,
  townsTotal,
}: {
  crew: { name: string; color: string };
  members: Member[];
  /** The playground quest. */
  progress: Progress;
  /** Every park, playground or not (her paper list's second count). */
  every: Progress;
  townsTotal: number;
}) {
  const color = crayon(crew.color);
  const percent = pct(progress);
  const toGo = progress.total - progress.done;
  const finished = progress.total > 0 && toGo === 0;
  return (
    <section
      aria-label="Passport cover"
      className="doodle-box relative overflow-hidden px-4 pt-4 pb-5 shadow-[4px_5px_0_#2b2a33]"
    >
      {/* Cover band in the crew's color; grows with long crew names */}
      <div
        className="wax relative -mx-4 -mt-4 px-4 pt-4 pb-8"
        style={{ backgroundColor: color }}
      >
        <Sun className="absolute -top-3 -right-3 h-20 w-20 opacity-90" />
        <p className="relative font-hand text-sm tracking-[0.3em] text-white/90 uppercase">
          Official Park Passport
        </p>
        <h1 className="relative pr-10 font-sketch text-[2.4rem] leading-none font-bold text-white drop-shadow-[2px_2px_0_#2b2a33]">
          {crew.name}
        </h1>
      </div>

      {/* Crew avatars, peeking over the band edge */}
      <ul className="relative -mt-6 flex items-end -space-x-2">
        {members.map((m, i) => (
          <li
            key={m.id}
            className="flex h-12 w-12 items-center justify-center rounded-full border-[2.5px] border-ink text-2xl shadow-[2px_2px_0_#2b2a33]"
            style={{
              backgroundColor: crayon(m.color),
              transform: `rotate(${i % 2 ? 6 : -6}deg)`,
              zIndex: members.length - i,
            }}
            title={m.name}
          >
            <span aria-hidden>{m.avatar}</span>
            <span className="sr-only">{m.name}</span>
          </li>
        ))}
        <li className="min-w-0 truncate pb-0.5 pl-4 font-hand text-lg text-ink-soft">
          {members.map((m) => m.name).join(" + ")}
        </li>
      </ul>

      {/* The big meter */}
      <div
        className="relative mx-auto mt-2 aspect-square w-[min(78vw,290px)]"
        role="img"
        aria-label={`${progress.done} of ${progress.total} playgrounds done, ${percent} percent`}
      >
        <Ring progress={progress} color={color} />
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="font-sketch text-[4.2rem] leading-[0.9] font-bold">
            {progress.done}
          </span>
          <span className="font-hand text-xl leading-tight text-ink-soft">
            of {progress.total} playgrounds
          </span>
          <span
            className={`highlight mt-1 font-sketch font-bold ${finished ? "animate-float text-2xl" : "text-3xl"}`}
            style={{ ["--hl" as string]: "#f7c933" }}
          >
            {finished ? "🏆 We did it!" : `${percent}%`}
          </span>
        </div>
      </div>

      <ul className="mt-1 flex flex-wrap justify-center gap-2">
        <li className="chip" style={{ backgroundColor: `${color}26` }}>
          🖍️ {progress.coloredIn} colored in
        </li>
        {progress.crossedOff > 0 && (
          <li className="chip">
            <span className="line-through decoration-2">✏️</span>{" "}
            {progress.crossedOff} crossed off
          </li>
        )}
        <li className="chip">
          {toGo === 0 ? "🎉 All done!" : `🎯 ${toGo} to go`}
        </li>
      </ul>
      {every.total > progress.total && (
        <p className="mt-2 text-center font-hand text-lg text-ink-soft">
          🌳 Every park, playground or not:{" "}
          <span className="text-ink">
            {every.done} of {every.total}
          </span>
        </p>
      )}

      <div className="mt-4 flex items-center justify-between gap-2">
        <Pines className="h-10 w-24 shrink-0" />
        <Link
          href="/list"
          className="flex min-h-11 items-center font-hand text-xl underline decoration-crayon-blue decoration-wavy decoration-2 underline-offset-4"
        >
          See the whole list →
        </Link>
      </div>
      <span className="sr-only">Across {townsTotal} towns.</span>
    </section>
  );
}
